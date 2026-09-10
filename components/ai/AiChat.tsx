'use client';

import { useEffect, useState } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  _count: { messages: number };
};

const SUGGESTIONS = [
  '¿Cuáles son mis páginas peor enlazadas?',
  '¿Cuáles son los problemas SEO más críticos?',
  '¿Dónde se está desperdiciando PageRank?',
  '¿Qué páginas deberían recibir más enlaces?',
  '¿Cuáles son mis clusters más aislados?',
];

export function AiChat({
  crawlId,
  enabled,
}: {
  crawlId: string;
  enabled: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  // Las conversaciones se guardan en base de datos: al abrir la pestaña
  // recuperamos las anteriores en lugar de empezar siempre de cero.
  useEffect(() => {
    if (!enabled) return;
    fetch(`/api/crawls/${crawlId}/ai/chat`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => setConversations(b.conversations ?? []))
      .catch(() => undefined);
  }, [crawlId, enabled]);

  async function openConversation(id: string) {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/crawls/${crawlId}/ai/chat?conversationId=${id}`,
      { cache: 'no-store' },
    );
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return;

    setConversationId(id);
    setMessages(
      (body.conversation?.messages ?? [])
        .filter((m: Message) => m.role === 'user' || m.role === 'assistant')
        .map((m: Message) => ({ role: m.role, content: m.content })),
    );
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setTools([]);
    setError(null);
  }

  async function send(text: string) {
    if (!text.trim() || loading) return;

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setError(null);
    setTools([]);

    const res = await fetch(`/api/crawls/${crawlId}/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? 'La consulta falló');
      setLoading(false);
      return;
    }

    if (body.conversationId && body.conversationId !== conversationId) {
      setConversationId(body.conversationId);
      fetch(`/api/crawls/${crawlId}/ai/chat`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((b) => setConversations(b.conversations ?? []))
        .catch(() => undefined);
    }

    setTools((body.tools ?? []).map((t: { name: string }) => t.name));
    setMessages((m) => [...m, { role: 'assistant', content: body.reply }]);
    setLoading(false);
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Ask AI about this crawl</p>
          <p className="text-sm text-muted">
            La IA consulta los datos mediante herramientas acotadas al crawl; no
            ejecuta SQL libre.
          </p>
        </div>

        {conversations.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="input w-auto py-1 text-xs"
              value={conversationId ?? ''}
              onChange={(e) =>
                e.target.value ? openConversation(e.target.value) : newConversation()
              }
            >
              <option value="">Nueva conversación</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.title ?? 'Sin título').slice(0, 45)} ({c._count.messages})
                </option>
              ))}
            </select>
            {conversationId && (
              <button className="btn text-xs" onClick={newConversation}>
                Nueva
              </button>
            )}
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              className="btn text-xs"
              onClick={() => send(suggestion)}
              disabled={!enabled || loading}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`rounded-md px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'ml-8 bg-accent/10 text-fg'
                  : 'mr-4 bg-panel2'
              }`}
            >
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                {message.role === 'user' ? 'Tú' : 'Analista IA'}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {message.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {tools.length > 0 && (
        <p className="text-[11px] text-muted">
          Herramientas usadas: {tools.join(', ')}
        </p>
      )}

      {loading && <p className="text-sm text-muted">Consultando los datos…</p>}

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            enabled
              ? 'Pregunta sobre este crawl…'
              : 'Configura DEEPSEEK_API_KEY para usar el chat'
          }
          disabled={!enabled || loading}
        />
        <button className="btn btn-primary" disabled={!enabled || loading}>
          Enviar
        </button>
      </form>
    </div>
  );
}
