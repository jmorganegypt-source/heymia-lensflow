const PRIMARY = "gemini-3.8-flash";
const FALLBACKS = ["gemini-3.6-flash", "gemini-2.5-flash"];
const WORKERS_AI_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];

const AGENT_PROMPTS = {
  Mia: "You are Mia, operational partner for John Morgan (LensFlow, Glimr, Missing Cash, HeyMia). Work mode: fast, structured, never invent data. You can use tools to list the vault, publish websites, route files, create rooms, and read worker status. Be concise and actionable.",
  Jess: "You are Jess, a warm companion in Play mode. Conversational and ready for LiveAvatar. Do not invent business facts.",
};

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "worker_status",
        description: "Check vault, AI bindings, and secrets on this Worker.",
        parameters: { type: "OBJECT", properties: {}, required: [] },
      },
      {
        name: "list_vault",
        description: "List files in the HeyMia R2 vault.",
        parameters: { type: "OBJECT", properties: { prefix: { type: "STRING" } }, required: [] },
      },
      {
        name: "publish_site",
        description: "Publish a static website to /s/{slug}/ on this Worker.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            slug: { type: "STRING" },
            tagline: { type: "STRING" },
            html: { type: "STRING" },
          },
          required: ["name"],
        },
      },
      {
        name: "route_file",
        description: "Classify a file and suggest LiveAvatar, ElevenLabs, scripts, or vault.",
        parameters: {
          type: "OBJECT",
          properties: {
            fileName: { type: "STRING" },
            fileType: { type: "STRING" },
            category: { type: "STRING" },
          },
          required: ["fileName"],
        },
      },
      {
        name: "create_room",
        description: "Save a fantasy room scene for later sessions.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            theme: { type: "STRING" },
            prompt: { type: "STRING" },
          },
          required: ["name"],
        },
      },
    ],
  },
];

export function getSystemPrompt(agent) {
  return AGENT_PROMPTS[agent] || AGENT_PROMPTS.Mia;
}

export function routeFile(fileName, fileType, category) {
  const n = (fileName || "").toLowerCase();
  const t = fileType || "";
  let destination = "vault";
  let reason = "Store in File Vault";
  let suggested_action = "Keep in vault for Mia to review";
  if (t.startsWith("video/") || n.includes("avatar") || n.includes("4k") || n.includes("lens")) {
    destination = "liveavatar";
    reason = "Video/avatar asset";
    suggested_action = "Queue for LiveAvatar";
  } else if (t.startsWith("audio/") || n.includes("voice") || n.includes("elevenlabs") || n.includes("tts")) {
    destination = "elevenlabs";
    reason = "Audio/voice asset";
    suggested_action = "Process with ElevenLabs";
  } else if (n.endsWith(".html") || n.endsWith(".htm")) {
    destination = "sites";
    reason = "HTML build";
    suggested_action = "Publish via /api/sites or Live build";
  } else if (n.includes("script") || n.endsWith(".txt") || n.endsWith(".md")) {
    destination = "scripts";
    reason = "Text/script";
    suggested_action = "Add to knowledge / training";
  } else if (category === "fanstudio" || n.includes("bedroom") || n.includes("jess")) {
    destination = "liveavatar";
    reason = "Fan Studio content";
    suggested_action = "Queue for Jess session";
  }
  return { destination, reason, suggested_action };
}

function geminiUrl(model, key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}

async function runGemini(key, model, body) {
  const res = await fetch(geminiUrl(model, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${model} HTTP ${res.status}`);
  return data;
}

function textFromCandidate(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

function callsFromCandidate(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.functionCall).map((p) => p.functionCall);
}

export async function handleAgentChat(env, body, helpers) {
  const messages = body.messages || [];
  const agent = body.agent || "Mia";
  const system = getSystemPrompt(agent);
  let filesNote = "";
  try {
    const files = await helpers.listFiles();
    if (files.length) filesNote = "\n\nVault files:\n" + files.slice(0, 40).map((f) => `- ${f.name || f.key} (${f.category || ""})`).join("\n");
  } catch {}

  const contents = [];
  for (const m of messages.slice(-16)) {
    contents.push({
      role: m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: String(m.content || "") }],
    });
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "Hello" }] });

  const payload = {
    systemInstruction: { parts: [{ text: system + filesNote }] },
    contents,
    tools: TOOLS,
    generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
  };

  const geminiKey = env.GEMINI_API_KEY || env.GEMINI;
  const models = [env.GEMINI_MODEL || PRIMARY, ...FALLBACKS];
  let lastErr = null;
  if (geminiKey) {
    for (const model of models) {
      try {
        let data = await runGemini(geminiKey, model, payload);
        for (let i = 0; i < 4; i++) {
          const calls = callsFromCandidate(data);
          if (!calls.length) {
            const reply = textFromCandidate(data);
            if (reply) return { response: reply, agent, model, tools: i > 0 };
            break;
          }
          const fnParts = [];
          for (const call of calls) {
            const result = await helpers.runTool(call.name, call.args || {});
            fnParts.push({ functionResponse: { name: call.name, response: result } });
          }
          payload.contents = [
            ...payload.contents,
            { role: "model", parts: calls.map((c) => ({ functionCall: c })) },
            { role: "user", parts: fnParts },
          ];
          data = await runGemini(geminiKey, model, payload);
        }
        const reply = textFromCandidate(data);
        if (reply) return { response: reply, agent, model, tools: true };
      } catch (err) {
        lastErr = String(err.message || err);
      }
    }
  }

  if (env.AI && typeof env.AI.run === "function") {
    const transcript = [
      { role: "system", content: system + filesNote },
      ...messages.slice(-12).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      })),
    ];
    for (const model of WORKERS_AI_MODELS) {
      try {
        const out = await env.AI.run(model, { messages: transcript, max_tokens: 1024 });
        const reply = out.response || out.result?.response || (typeof out === "string" ? out : "");
        if (reply) return { response: reply, agent, model, tools: false };
      } catch (err) {
        lastErr = String(err.message || err);
      }
    }
  }

  const last = messages[messages.length - 1]?.content || "";
  return {
    response:
      "Mia is online but no Gemini or Workers AI key answered. Set GEMINI_API_KEY and bind AI. Last error: " +
      (lastErr || "none") +
      (last ? ' You said: "' + String(last).slice(0, 120) + '"' : ""),
    agent,
    model: "fallback",
    error: lastErr,
  };
}
