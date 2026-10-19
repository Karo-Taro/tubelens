// Пресеты AI-провайдеров. format: 'openai' — совместимый /chat/completions, 'anthropic' — /messages.
// Добавьте свой провайдер, просто дописав объект в массив.

export const HELPER_AI = 'http://127.0.0.1:47321/v1';

export const AI_PRESETS = [
  { id: 'cli', name: 'CLI-агент на этом компьютере (Claude Code, Codex, Gemini CLI, Ollama)', format: 'openai', baseUrl: HELPER_AI, noKey: true,
    models: ['claude', 'codex', 'gemini', 'ollama/llama3.2'], keyUrl: '',
    note: 'Без API-ключа: запросы идут в установленный CLI через помощник TubeLens. Нужны запущенный помощник (раздел «Загрузки») и CLI с выполненным входом. «Загрузить список» покажет, какие CLI найдены.' },
  { id: 'openai', name: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic (Claude)', format: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', name: 'Google Gemini', format: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'], keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter (агрегатор)', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-5.5', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'],
    keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', format: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], keyUrl: 'https://console.groq.com/keys' },
  { id: 'deepseek', name: 'DeepSeek', format: 'openai', baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'mistral', name: 'Mistral', format: 'openai', baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-small-latest', 'mistral-large-latest'], keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'together', name: 'Together AI', format: 'openai', baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'], keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'fireworks', name: 'Fireworks AI', format: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], keyUrl: 'https://fireworks.ai/account/api-keys' },
  { id: 'xai', name: 'xAI (Grok)', format: 'openai', baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3-mini', 'grok-3'], keyUrl: 'https://console.x.ai' },
  { id: 'perplexity', name: 'Perplexity', format: 'openai', baseUrl: 'https://api.perplexity.ai',
    models: ['sonar', 'sonar-pro'], keyUrl: 'https://www.perplexity.ai/settings/api' },
  { id: 'cerebras', name: 'Cerebras', format: 'openai', baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b'], keyUrl: 'https://cloud.cerebras.ai' },
  { id: 'ollama', name: 'Ollama (локально)', format: 'openai', baseUrl: 'http://localhost:11434/v1', noKey: true,
    models: ['llama3.2', 'qwen2.5', 'mistral'], keyUrl: 'https://ollama.com',
    note: 'Запустите Ollama с переменной OLLAMA_ORIGINS=chrome-extension://*' },
  { id: 'lmstudio', name: 'LM Studio (локально)', format: 'openai', baseUrl: 'http://localhost:1234/v1', noKey: true,
    models: ['local-model'], keyUrl: 'https://lmstudio.ai', note: 'Включите сервер в LM Studio (Developer → Start server) и CORS.' },
  { id: 'litellm', name: 'LiteLLM Proxy (локально)', format: 'openai', baseUrl: 'http://localhost:4000/v1', noKey: true,
    models: [], keyUrl: 'https://docs.litellm.ai/docs/simple_proxy', note: 'Любые модели через свой прокси LiteLLM. Ключ — master key, если он задан.' },
  { id: 'cliproxy', name: 'CLIProxyAPI (подписка Claude/Gemini/ChatGPT как API)', format: 'openai', baseUrl: 'http://localhost:8317/v1', noKey: true,
    models: [], keyUrl: 'https://github.com/router-for-me/CLIProxyAPI', note: 'Прокси, который превращает вход в CLI-агентов в OpenAI-совместимый API. Порт по умолчанию 8317.' },
  { id: 'custom', name: 'Свой эндпоинт', format: 'openai', baseUrl: '', models: [], keyUrl: '' },
];

export const presetById = (id) => AI_PRESETS.find((p) => p.id === id) || AI_PRESETS[AI_PRESETS.length - 1];
