import { config } from './config.js';

// 调用 grsai Chat API（与 OpenAI /v1/chat/completions 接口一致）
export async function chat(messages, { temperature = 0.7 } = {}) {
  const res = await fetch(`${config.ai.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      stream: false,
      temperature,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI 接口调用失败 (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 接口返回内容为空');
  return content;
}

// 从模型输出中稳健地提取 JSON（兼容 ```json 代码块包裹的情况）
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 输出中未找到 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}
