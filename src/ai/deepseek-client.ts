import type { UserAiConfig } from '../../lib/settings';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      'No hay clave de IA configurada en esta cuenta. Añádela en Ajustes → Inteligencia artificial.',
    );
  }
}

export class AiRequestError extends Error {}

type ChatOptions = {
  /** Configuración de la cuenta que hace la llamada. */
  config: UserAiConfig;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatResponse = {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { prompt: number; completion: number; total: number } | null;
  model: string;
};

/**
 * Cliente mínimo de DeepSeek (API compatible con OpenAI chat/completions).
 *
 * La clave, el modelo y el endpoint llegan por parámetro porque son de
 * cada cuenta: no hay una configuración global compartida.
 */
export async function chat(options: ChatOptions): Promise<ChatResponse> {
  const { config } = options;
  if (!config.apiKey) throw new AiNotConfiguredError();

  const body: Record<string, unknown> = {
    model: config.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 4000,
    stream: false,
  };

  if (options.jsonMode) body.response_format = { type: 'json_object' };
  if (options.tools?.length) body.tools = options.tools;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AiRequestError(
      `DeepSeek respondió ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; tool_calls?: ToolCall[] } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const message = json.choices?.[0]?.message;

  return {
    content: message?.content ?? null,
    toolCalls: message?.tool_calls ?? [],
    usage: json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0,
        }
      : null,
    model: json.model ?? config.model,
  };
}

/**
 * Recorta un JSON truncado hasta el último elemento completo y cierra los
 * corchetes que quedaron abiertos.
 *
 * Los modelos cortan la respuesta al agotar `max_tokens` y el documento
 * queda partido a mitad de un array. Como el esquema tiene valores por
 * defecto para casi todo, recuperar el prefijo válido salva el informe en
 * lugar de perderlo entero.
 */
export function repairTruncatedJson(text: string): string | null {
  const scan = (input: string) => {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let lastComma = -1;
    let lastCloser = -1;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        if (inString) escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        stack.pop();
        lastCloser = i;
      } else if (char === ',') lastComma = i;
    }

    return { stack, inString, lastComma, lastCloser };
  };

  const first = scan(text);
  if (first.stack.length === 0 && !first.inString) return text;

  // Cortamos tras el último valor que sí llegó completo.
  const cut = Math.max(first.lastComma, first.lastCloser);
  if (cut < 0) return null;

  const prefix = text.slice(0, text[cut] === ',' ? cut : cut + 1);

  const second = scan(prefix);
  if (second.inString) return null;

  let repaired = prefix;
  for (let i = second.stack.length - 1; i >= 0; i--) {
    repaired += second.stack[i] === '{' ? '}' : ']';
  }

  return repaired;
}

/** Extrae el primer objeto JSON de una respuesta, reparándolo si vino cortado. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    /* seguimos con las estrategias de recuperación */
  }

  const start = candidate.indexOf('{');
  if (start === -1) {
    throw new AiRequestError('La respuesta de la IA no contenía JSON');
  }

  const body = candidate.slice(start);

  // 1) El JSON está completo pero rodeado de texto.
  const end = body.lastIndexOf('}');
  if (end > 0) {
    try {
      return JSON.parse(body.slice(0, end + 1));
    } catch {
      /* probablemente truncado: lo reparamos abajo */
    }
  }

  // 2) La respuesta se cortó por límite de tokens.
  const repaired = repairTruncatedJson(body);
  if (repaired) {
    try {
      return JSON.parse(repaired);
    } catch {
      /* irrecuperable */
    }
  }

  throw new AiRequestError(
    'La respuesta de la IA se cortó y no se pudo reconstruir el JSON',
  );
}
