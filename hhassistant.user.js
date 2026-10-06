// ==UserScript==
// @name         HH.ru Auto-Apply Assistant (Multi-AI v5.4)
// @namespace    http://tampermonkey.net/
// @version      5.4
// @description  Умный автоотклик на hh.ru с поддержкой Gemini, Claude и Qwen.
// @author       HH Auto-Apply Builder
// @match        https://*.hh.ru/search/*
// @match        https://*.hh.ru/vacancy/*
// @match        https://*.hh.ru/applicant/*
// @match        https://hh.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      api.anthropic.com
// @connect      dashscope.aliyuncs.com
// @connect      dashscope-intl.aliyuncs.com
// @connect      api.hh.ru
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULT_RESUMES = [
        "Senior Project Manager PMP (AI, Digital Transformation)",
        "Program Manager / Delivery Lead",
        "Senior IT Project Manager (PMP)",
        "Scrum Master / Agile Delivery Manager"
    ];

    let USER_PROFILE = GM_getValue('autoApplyUserProfile', `PMP сертифицированный руководитель проектов с 10+ летним опытом управления IT-программами в международных корпорациях:
- Alcoa (аэрокосмический сектор, ключевой поставщик Boeing)
- Nestle (портфель 30+ digital-проектов, бюджет 150+ млн руб)
- Северсталь Tech Lab (Industrial AI, успешный вывод CV-систем в production)
Опыт параллельного ведения масштабных программ, управление стейкхолдерами, повышение velocity команды на 20% после Scrum-трансформации. Свободный английский, паспорт ЕС, полная готовность к релокации.`);

    let RESUME_LIST = JSON.parse(GM_getValue('autoApplyResumeList', JSON.stringify(DEFAULT_RESUMES)));

    const AI_PROVIDERS = {
        gemini: {
            name: 'Google Gemini',
            icon: '💎',
            models: [
            { id: 'gemini-flash-latest', name: 'Gemini Flash Latest (быстрый, рекомендуется)' },
            { id: 'gemini-flash-lite-latest', name: 'Gemini Flash-Lite Latest (сверхбыстрый)' },
            { id: 'gemini-pro-latest', name: 'Gemini Pro Latest (качественный)' }
        ],
        defaultModel: 'gemini-flash-latest'
    },
    claude: {
        name: 'Anthropic Claude',
        icon: '🟠',
        models: [
            { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (быстрый, дешевый)' },
            { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (качественный)' },
            { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (максимум)' }
        ],
        defaultModel: 'claude-haiku-4-5'
    },
    qwen: {
        name: 'Alibaba Qwen',
        icon: '🔵',
        models: [
            { id: 'qwen-turbo', name: 'Qwen Turbo (быстрый)' },
            { id: 'qwen-plus', name: 'Qwen Plus (средний)' },
            { id: 'qwen-max', name: 'Qwen Max (качественный)' }
        ],
        defaultModel: 'qwen-plus'
    }
};

    const CONFIG = {
        applyLimit: 30,
        delayMinMs: 3000,
        delayMaxMs: 7000,
        coverLetterMode: GM_getValue('autoApplyCoverLetterMode', "ai"),
        coverLetterTemplate: GM_getValue('autoApplyCoverLetterTemplate', "Здравствуйте!\n\nМеня очень заинтересовала ваша вакансия \"{vacancy_title}\" в компании \"{company_name}\".\n\nЯ — сертифицированный руководитель проектов (PMP) с более чем 10-летним опытом управления IT-программами в крупнейших международных корпорациях (Alcoa, Nestle, Северсталь Тех Лаб). Имею опыт внедрения Industrial AI, управления портфелем из 30+ проектов и повышения velocity команды на 20%.\n\nОбладаю паспортом ЕС, свободным английским и полностью готов к релокации.\n\nБуду рад обсудить подробности на собеседовании!\n\nС уважением,\nКандидат"),
        aiProvider: GM_getValue('autoApplyAiProvider', "gemini"),
        geminiApiKey: GM_getValue('autoApplyGeminiApiKey', ""),
        geminiModel: GM_getValue('autoApplyGeminiModel', AI_PROVIDERS.gemini.defaultModel),
        claudeApiKey: GM_getValue('autoApplyClaudeApiKey', ""),
        // Модели Claude 3.x выведены из эксплуатации и возвращают 404 — переключаем на актуальную
        claudeModel: (() => {
            const saved = GM_getValue('autoApplyClaudeModel', AI_PROVIDERS.claude.defaultModel);
            return AI_PROVIDERS.claude.models.some(m => m.id === saved) ? saved : AI_PROVIDERS.claude.defaultModel;
        })(),
        qwenApiKey: GM_getValue('autoApplyQwenApiKey', ""),
        qwenModel: GM_getValue('autoApplyQwenModel', AI_PROVIDERS.qwen.defaultModel),
        selectedResumeTitle: GM_getValue('autoApplySelectedResume', RESUME_LIST[0] || DEFAULT_RESUMES[0]),
        questionsAction: GM_getValue('autoApplyQuestionsAction', "notify"),
        autoConfirmRegion: GM_getValue('autoApplyAutoConfirmRegion', true),
        aiTemperature: GM_getValue('autoApplyAiTemperature', 0.7),
        aiMaxTokens: GM_getValue('autoApplyAiMaxTokens', 1000)
    };

    let state = {
        active: GM_getValue('autoApplyActive', false),
        scanned: GM_getValue('autoApplyScanned', 0),
        applied: GM_getValue('autoApplyApplied', 0),
        skipped: GM_getValue('autoApplySkipped', 0),
        logs: JSON.parse(GM_getValue('autoApplyLogs', '[]'))
    };

    function saveState() {
        GM_setValue('autoApplyActive', state.active);
        GM_setValue('autoApplyScanned', state.scanned);
        GM_setValue('autoApplyApplied', state.applied);
        GM_setValue('autoApplySkipped', state.skipped);
        GM_setValue('autoApplyLogs', JSON.stringify(state.logs));
        updatePanelUI();
    }

    function addLog(status, title, company, salary, reason) {
        const logEntry = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            timestamp: new Date().toLocaleTimeString(),
            title: title || 'N/A',
            company: company || 'N/A',
            salary: salary || 'N/A',
            status: status,
            reason: reason || ''
        };
        state.logs.unshift(logEntry);
        if (state.logs.length > 200) state.logs.length = 200;
        saveState();
    }

    function saveResumeList() {
        GM_setValue('autoApplyResumeList', JSON.stringify(RESUME_LIST));
    }

    function addResume(title) {
        if (title && title.trim() && !RESUME_LIST.includes(title.trim())) {
            RESUME_LIST.push(title.trim());
            saveResumeList();
            return true;
        }
        return false;
    }

    function removeResume(index) {
        if (index >= 0 && index < RESUME_LIST.length) {
            const removed = RESUME_LIST.splice(index, 1)[0];
            saveResumeList();
            if (CONFIG.selectedResumeTitle === removed && RESUME_LIST.length > 0) {
                CONFIG.selectedResumeTitle = RESUME_LIST[0];
                GM_setValue('autoApplySelectedResume', CONFIG.selectedResumeTitle);
            }
            return true;
        }
        return false;
    }

    function updateResumeSelect() {
        const select = document.getElementById('hh-select-resume');
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '';
        RESUME_LIST.forEach((resume) => {
            const option = document.createElement('option');
            option.value = resume;
            option.textContent = resume;
            if (resume === CONFIG.selectedResumeTitle) option.selected = true;
            select.appendChild(option);
        });
        if (RESUME_LIST.length > 0 && !RESUME_LIST.includes(currentValue)) {
            CONFIG.selectedResumeTitle = RESUME_LIST[0];
            GM_setValue('autoApplySelectedResume', CONFIG.selectedResumeTitle);
        }
    }

    function renderResumeListInSettings() {
        const container = document.getElementById('hh-resume-list-container');
        if (!container) return;
        container.innerHTML = '';
        if (RESUME_LIST.length === 0) {
            container.innerHTML = '<div style="color: #6b7280; font-size: 12px; text-align: center; padding: 10px;">Список пуст. Добавьте резюме выше.</div>';
            return;
        }
        RESUME_LIST.forEach((resume, index) => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: #374151; padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #4b5563;';
            const text = document.createElement('span');
            text.textContent = resume;
            text.style.cssText = 'color: #f3f4f6; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;';
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️';
            deleteBtn.style.cssText = 'background: #dc2626; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;';
            deleteBtn.onclick = () => {
                if (confirm(`Удалить резюме "${resume}"?`)) {
                    removeResume(index);
                    renderResumeListInSettings();
                    updateResumeSelect();
                    addLog('info', 'System', 'Resume', '-', `🗑️ Удалено резюме: ${resume}`);
                }
            };
            item.appendChild(text);
            item.appendChild(deleteBtn);
            container.appendChild(item);
        });
    }

    const SCRIPT_VERSION = '5.4';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fillTemplate(jobTitle, companyName) {
        return CONFIG.coverLetterTemplate
            .replace(/{vacancy_title}/g, jobTitle)
            .replace(/{company_name}/g, companyName);
    }

    // \b в JS-регулярках работает только для ASCII, поэтому кириллические слова
    // считаем без границ слова (раньше кириллица не находилась вовсе и любая
    // русская вакансия с парой английских терминов определялась как английская).
    function detectLanguage(text) {
        if (!text) return 'ru';
        const cleanText = text.replace(/<[^>]*>/g, ' ');
        const cyrillicWords = cleanText.match(/[а-яё]{2,}/gi) || [];
        const latinWords = cleanText.match(/[a-z]{2,}/gi) || [];
        const totalWords = cyrillicWords.length + latinWords.length;
        if (totalWords === 0) return 'ru';
        return (latinWords.length / totalWords) > 0.6 ? 'en' : 'ru';
    }

    function getVacancyId(url) {
        const match = String(url || '').match(/\/vacancy\/(\d+)/) || String(url || '').match(/vacancyId=(\d+)/);
        return match ? match[1] : null;
    }

    function htmlToText(html) {
        if (!html) return '';
        const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
        doc.querySelectorAll('li').forEach(li => li.insertBefore(doc.createTextNode('• '), li.firstChild));
        doc.querySelectorAll('br, p, li, div, h1, h2, h3, h4, ul, ol').forEach(el => el.appendChild(doc.createTextNode('\n')));
        return (doc.body.textContent || '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    }

    // Достает описание вакансии и ключевые навыки из документа страницы вакансии.
    function extractDescriptionFromDoc(doc) {
        let description = '';
        const selectors = [
            '[data-qa="vacancy-description"]',
            '.vacancy-description',
            '[data-qa="vacancy-branded"]',
            '.vacancy-branded-user-content'
        ];
        for (const selector of selectors) {
            const el = doc.querySelector(selector);
            if (el && el.innerHTML.trim()) {
                description = htmlToText(el.innerHTML);
                if (description) break;
            }
        }

        // Запасной вариант: hh.ru кладет состояние страницы в JSON внутри <template id="HH-Lux-InitialState">
        if (!description) {
            const stateEl = doc.querySelector('#HH-Lux-InitialState, template[id*="InitialState"]');
            if (stateEl) {
                try {
                    const json = JSON.parse(stateEl.innerHTML || stateEl.textContent);
                    const view = json.vacancyView || {};
                    description = htmlToText(view.description || (view.branding && view.branding.description) || '');
                } catch (e) { /* формат мог поменяться */ }
            }
        }

        const skills = Array.from(doc.querySelectorAll('[data-qa="skills-element"], [data-qa="bloko-tag__text"]'))
            .map(el => el.textContent.trim()).filter(Boolean);
        const uniqueSkills = [...new Set(skills)];
        if (description && uniqueSkills.length) {
            description += `\n\nКлючевые навыки: ${uniqueSkills.join(', ')}`;
        }
        return description;
    }

    function fetchFromHhApi(vacancyId) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.hh.ru/vacancies/${vacancyId}`,
                headers: { 'Accept': 'application/json' },
                timeout: 15000,
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        addLog('info', 'System', 'Fetch', '-', `⚠️ api.hh.ru вернул ${response.status}`);
                        resolve('');
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText);
                        let text = htmlToText(data.description || '');
                        const skills = (data.key_skills || []).map(s => s.name).filter(Boolean);
                        if (text && skills.length) text += `\n\nКлючевые навыки: ${skills.join(', ')}`;
                        resolve(text);
                    } catch (e) {
                        resolve('');
                    }
                },
                onerror: () => resolve(''),
                ontimeout: () => resolve('')
            });
        });
    }

    async function fetchVacancyDescription(url) {
        const vacancyId = getVacancyId(url);
        if (!url || !vacancyId) {
            addLog('info', 'System', 'Fetch', '-', `⚠️ Не удалось определить ID вакансии по ссылке: ${url || 'нет ссылки'}`);
            return '';
        }

        // 1. Мы уже на странице этой вакансии — читаем прямо из DOM.
        if (getVacancyId(location.href) === vacancyId) {
            const fromPage = extractDescriptionFromDoc(document);
            if (fromPage) {
                addLog('info', 'System', 'Fetch', '-', `✅ Описание взято со страницы: ${fromPage.length} симв.`);
                return fromPage;
            }
        }

        // 2. Загружаем HTML страницы вакансии с того же домена (ссылка из выдачи может вести на другой поддомен).
        const pageUrl = `${location.origin}/vacancy/${vacancyId}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(pageUrl, { signal: controller.signal, credentials: 'include' });
            clearTimeout(timeoutId);
            if (response.ok) {
                const html = await response.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const description = extractDescriptionFromDoc(doc);
                if (description) {
                    addLog('info', 'System', 'Fetch', '-', `✅ Описание загружено: ${description.length} симв.`);
                    return description;
                }
                addLog('info', 'System', 'Fetch', '-', '⚠️ На странице вакансии описание не найдено, пробую api.hh.ru');
            } else {
                addLog('info', 'System', 'Fetch', '-', `⚠️ HTTP ${response.status} при загрузке вакансии, пробую api.hh.ru`);
            }
        } catch (e) {
            addLog('info', 'System', 'Fetch', '-', `⚠️ Ошибка загрузки страницы (${e.message}), пробую api.hh.ru`);
        }

        // 3. Публичный API hh.ru.
        const fromApi = await fetchFromHhApi(vacancyId);
        if (fromApi) {
            addLog('info', 'System', 'Fetch', '-', `✅ Описание получено через api.hh.ru: ${fromApi.length} симв.`);
        } else {
            addLog('info', 'System', 'Fetch', '-', '❌ Описание вакансии получить не удалось');
        }
        return fromApi;
    }

    function buildPrompt(jobTitle, companyName, vacancyDescription) {
        const isEnglish = detectLanguage(vacancyDescription + ' ' + jobTitle) === 'en';

        if (isEnglish) {
            return {
                lang: 'en',
                system: 'You are an expert career coach. You write compelling, concise cover letters tailored to a specific vacancy, using only facts from the candidate profile.',
                user: `I am applying for the position "${jobTitle}" at "${companyName}".

<vacancy_description>
${vacancyDescription || 'No detailed description provided. Focus on the job title.'}
</vacancy_description>

<my_profile>
${USER_PROFILE}
</my_profile>

Write a cover letter in ENGLISH for THIS vacancy:
1. Identify the 2-3 most important requirements or tasks from the vacancy description and name them explicitly.
2. For each one, show matching experience from my profile with concrete facts and numbers.
3. Mention the company name and why this role is interesting to me.
4. Use only facts from my profile; do not invent experience, companies or numbers.
5. 3-4 short paragraphs, at most 200 words, professional but warm tone, no generic filler phrases.
6. Output only the letter text: no markdown, no quotes, no subject line, no placeholders like [Name].`
            };
        }
        return {
            lang: 'ru',
            system: 'Вы — эксперт по карьере. Вы пишете убедительные лаконичные сопроводительные письма под конкретную вакансию, используя только факты из профиля кандидата.',
            user: `Я откликаюсь на вакансию "${jobTitle}" в компании "${companyName}".

<описание_вакансии>
${vacancyDescription || 'Подробное описание не предоставлено. Ориентируйтесь на название вакансии.'}
</описание_вакансии>

<мой_профиль>
${USER_PROFILE}
</мой_профиль>

Напишите сопроводительное письмо на РУССКОМ языке именно под ЭТУ вакансию:
1. Выделите 2-3 самых важных требования или задачи из описания вакансии и явно их назовите.
2. Для каждого покажите соответствующий опыт из моего профиля с конкретными фактами и цифрами.
3. Упомяните название компании и чем мне интересна эта позиция.
4. Используйте только факты из профиля, не выдумывайте опыт, компании и цифры.
5. 3-4 коротких абзаца, не более 200 слов, профессиональный и доброжелательный тон, без шаблонных фраз.
6. Выведите только текст письма: без markdown, кавычек, темы письма и заглушек вида [Имя].`
        };
    }

    function cleanAiText(text) {
        return text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/\*\*/g, '').trim();
    }

    // Модели с «размышлениями» тратят часть лимита токенов на reasoning,
    // поэтому лимит запроса берем с запасом, а длину письма задаем в промпте.
    function requestTokenLimit() {
        return Math.max(CONFIG.aiMaxTokens, 800) + 3000;
    }

    async function generateAICoverLetter(jobTitle, companyName, vacancyDescription) {
        const prompt = buildPrompt(jobTitle, companyName, vacancyDescription);
        const provider = CONFIG.aiProvider;
        const providerInfo = AI_PROVIDERS[provider];

        addLog('info', jobTitle, companyName, '-', `🤖 ${providerInfo.icon} ${providerInfo.name} (${CONFIG[provider + 'Model']}), язык: ${prompt.lang}, описание: ${vacancyDescription ? vacancyDescription.length : 0} симв.`);

        try {
            let result = null;
            if (provider === 'gemini') {
                result = await generateWithGemini(prompt);
            } else if (provider === 'claude') {
                result = await generateWithClaude(prompt);
            } else if (provider === 'qwen') {
                result = await generateWithQwen(prompt);
            } else {
                throw new Error(`Неизвестный провайдер: ${provider}`);
            }

            if (result && result.length >= 50) {
                addLog('info', jobTitle, companyName, '-', `✅ Ответ ИИ: ${result.length} симв. «${result.substring(0, 120)}...»`);
                return result;
            }
            addLog('info', jobTitle, companyName, '-', '⚠️ Пустой или слишком короткий ответ от ИИ');
            return null;
        } catch (e) {
            console.error(`${provider} generation failed:`, e);
            addLog('info', 'System', 'AI', '-', `❌ Ошибка ${providerInfo.name}: ${e.message}`);
            return null;
        }
    }

    function generateWithGemini(prompt) {
        return new Promise((resolve, reject) => {
            if (!CONFIG.geminiApiKey) {
                reject(new Error('Gemini API Key не указан'));
                return;
            }

            const modelsToTry = [...new Set([CONFIG.geminiModel, 'gemini-flash-latest', 'gemini-flash-lite-latest'])];
            let currentModelIndex = 0;
            let lastError = '';

            function tryNextModel() {
                if (currentModelIndex >= modelsToTry.length) {
                    reject(new Error(`Все модели Gemini недоступны (${lastError})`));
                    return;
                }
                const model = modelsToTry[currentModelIndex++];

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.geminiApiKey },
                    timeout: 90000,
                    data: JSON.stringify({
                        systemInstruction: { parts: [{ text: prompt.system }] },
                        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
                        generationConfig: {
                            temperature: CONFIG.aiTemperature,
                            maxOutputTokens: requestTokenLimit()
                        }
                    }),
                    onload: function(response) {
                        if (response.status < 200 || response.status >= 300) {
                            lastError = `${model}: HTTP ${response.status} ${response.responseText.substring(0, 200)}`;
                            addLog('info', 'System', 'Gemini', '-', `⚠️ ${lastError}`);
                            // Неверный ключ — нет смысла перебирать модели
                            if (response.status === 400 && /API key/i.test(response.responseText)) {
                                reject(new Error('Неверный API ключ Gemini'));
                                return;
                            }
                            tryNextModel();
                            return;
                        }
                        try {
                            const data = JSON.parse(response.responseText);
                            const candidate = data?.candidates?.[0];
                            const text = (candidate?.content?.parts || [])
                                .filter(p => p.text && !p.thought)
                                .map(p => p.text).join('');
                            if (!text) {
                                throw new Error(`пустой ответ (finishReason: ${candidate?.finishReason || data?.promptFeedback?.blockReason || 'n/a'})`);
                            }
                            if (candidate.finishReason === 'MAX_TOKENS') {
                                addLog('info', 'System', 'Gemini', '-', '⚠️ Ответ обрезан по лимиту токенов — увеличьте «Макс. длина»');
                            }
                            if (model !== CONFIG.geminiModel) {
                                addLog('info', 'System', 'Gemini', '-', `✅ Модель ${model} работает, сохраняю.`);
                                CONFIG.geminiModel = model;
                                GM_setValue('autoApplyGeminiModel', model);
                            }
                            resolve(cleanAiText(text));
                        } catch (e) {
                            lastError = `${model}: ${e.message}`;
                            addLog('info', 'System', 'Gemini', '-', `⚠️ ${lastError}`);
                            tryNextModel();
                        }
                    },
                    onerror: function() {
                        lastError = `${model}: сетевая ошибка`;
                        tryNextModel();
                    },
                    ontimeout: function() {
                        lastError = `${model}: таймаут`;
                        tryNextModel();
                    }
                });
            }

            tryNextModel();
        });
    }

    function generateWithClaude(prompt) {
        return new Promise((resolve, reject) => {
            if (!CONFIG.claudeApiKey) {
                reject(new Error('Claude API Key не указан'));
                return;
            }

            const model = CONFIG.claudeModel;
            const isHaiku = /haiku/.test(model);
            const body = {
                model: model,
                max_tokens: requestTokenLimit(),
                system: prompt.system,
                messages: [{ role: 'user', content: prompt.user }]
            };
            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.claudeApiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            };
            if (isHaiku) {
                // Haiku 4.5 поддерживает temperature; у Sonnet/Opus 5.x параметр убран (400).
                body.temperature = CONFIG.aiTemperature;
            } else {
                // Письмо — простая задача: минимум размышлений, быстрее и дешевле.
                body.output_config = { effort: 'low' };
                // При отказе модели запрос автоматически уйдет на запасную модель.
                body.fallbacks = 'default';
                headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.anthropic.com/v1/messages',
                headers: headers,
                timeout: 120000,
                data: JSON.stringify(body),
                onload: function(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`Claude HTTP ${response.status}: ${response.responseText.substring(0, 300)}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.stop_reason === 'refusal') throw new Error('модель отказалась отвечать');
                        const text = (data.content || [])
                            .filter(block => block.type === 'text')
                            .map(block => block.text).join('');
                        if (!text) throw new Error(`пустой ответ (stop_reason: ${data.stop_reason})`);
                        resolve(cleanAiText(text));
                    } catch (e) {
                        reject(new Error(`Ошибка ответа Claude: ${e.message}`));
                    }
                },
                onerror: function() { reject(new Error('Claude: сетевая ошибка')); },
                ontimeout: function() { reject(new Error('Claude: таймаут')); }
            });
        });
    }

    function generateWithQwen(prompt) {
        return new Promise((resolve, reject) => {
            if (!CONFIG.qwenApiKey) {
                reject(new Error('Qwen API Key не указан'));
                return;
            }

            // Ключи из международной консоли Alibaba Cloud работают только с dashscope-intl.
            const endpoints = [
                'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
                'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
            ];
            const saved = GM_getValue('autoApplyQwenEndpoint', '');
            if (saved && endpoints.includes(saved)) endpoints.sort((a, b) => (a === saved ? -1 : b === saved ? 1 : 0));
            let index = 0;
            let lastError = '';

            function tryEndpoint() {
                if (index >= endpoints.length) {
                    reject(new Error(lastError || 'Qwen недоступен'));
                    return;
                }
                const url = endpoints[index++];
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: url,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${CONFIG.qwenApiKey}`
                    },
                    timeout: 90000,
                    data: JSON.stringify({
                        model: CONFIG.qwenModel,
                        messages: [
                            { role: 'system', content: prompt.system },
                            { role: 'user', content: prompt.user }
                        ],
                        temperature: CONFIG.aiTemperature,
                        max_tokens: requestTokenLimit()
                    }),
                    onload: function(response) {
                        if (response.status === 401 || response.status === 403) {
                            lastError = `Qwen HTTP ${response.status}: ${response.responseText.substring(0, 200)}`;
                            tryEndpoint();
                            return;
                        }
                        if (response.status < 200 || response.status >= 300) {
                            reject(new Error(`Qwen HTTP ${response.status}: ${response.responseText.substring(0, 300)}`));
                            return;
                        }
                        try {
                            const data = JSON.parse(response.responseText);
                            const text = data?.choices?.[0]?.message?.content;
                            if (!text) throw new Error('пустой ответ');
                            GM_setValue('autoApplyQwenEndpoint', url);
                            resolve(cleanAiText(text));
                        } catch (e) {
                            reject(new Error(`Ошибка ответа Qwen: ${e.message}`));
                        }
                    },
                    onerror: function() { lastError = 'Qwen: сетевая ошибка'; tryEndpoint(); },
                    ontimeout: function() { lastError = 'Qwen: таймаут'; tryEndpoint(); }
                });
            }

            tryEndpoint();
        });
    }

    let settingsModal = null;

    // ИСПРАВЛЕНИЕ: Надежная функция переключения провайдера
    function switchProvider(providerKey) {
        CONFIG.aiProvider = providerKey;

        // Обновляем визуальное выделение карточек
        Object.keys(AI_PROVIDERS).forEach(key => {
            const card = document.getElementById(`hh-provider-card-${key}`);
            if (card) {
                if (key === providerKey) {
                    card.style.background = '#374151';
                    card.style.borderColor = '#f59e0b';
                    card.style.borderWidth = '2px';
                } else {
                    card.style.background = '#1f2937';
                    card.style.borderColor = '#374151';
                    card.style.borderWidth = '1px';
                }
            }

            // Показываем/скрываем секции с API ключами
            const section = document.getElementById(`hh-provider-${key}-section`);
            if (section) {
                section.style.display = key === providerKey ? 'block' : 'none';
            }
        });

        addLog('info', 'System', 'AI', '-', ` Выбран провайдер: ${AI_PROVIDERS[providerKey].icon} ${AI_PROVIDERS[providerKey].name}`);
    }

    function openSettingsModal() {
        if (settingsModal) {
            settingsModal.style.display = 'flex';
            renderResumeListInSettings();
            // При повторном открытии обновляем выделение
            switchProvider(CONFIG.aiProvider);
            return;
        }

        settingsModal = document.createElement('div');
        settingsModal.id = 'hh-settings-modal';
        settingsModal.style.cssText = `
            display: flex; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 100000; align-items: center;
            justify-content: center; font-family: system-ui, -apple-system, sans-serif;
        `;

        const providerSections = Object.entries(AI_PROVIDERS).map(([key, info]) => {
            const modelsOptions = info.models.map(m =>
                `<option value="${m.id}" ${CONFIG[key + 'Model'] === m.id ? 'selected' : ''}>${m.name}</option>`
            ).join('');

            return `
                <div id="hh-provider-${key}-section" style="background: #1f2937; padding: 12px; border-radius: 6px; border: 1px solid #374151; margin-bottom: 8px; display: ${CONFIG.aiProvider === key ? 'block' : 'none'};">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <span style="font-size: 18px;">${info.icon}</span>
                        <strong style="color: #f3f4f6; font-size: 13px;">${info.name}</strong>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; color: #d1d5db; font-size: 12px; margin-bottom: 4px;">API Key:</label>
                        <input type="password" id="hh-${key}-api-key" value="${escapeHtml(CONFIG[key + 'ApiKey'])}"
                            style="width: 100%; background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 4px; padding: 6px 10px; font-family: monospace; font-size: 12px; box-sizing: border-box;"
                            placeholder="Введите ${info.name} API ключ..." />
                    </div>
                    <div>
                        <label style="display: block; color: #d1d5db; font-size: 12px; margin-bottom: 4px;">Модель:</label>
                        <select id="hh-${key}-model" style="width: 100%; background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 4px; padding: 6px 10px; font-size: 12px; box-sizing: border-box;">
                            ${modelsOptions}
                        </select>
                    </div>
                </div>
            `;
        }).join('');

        settingsModal.innerHTML = `
            <div style="background: #1f2937; border-radius: 12px; width: 720px; max-height: 90vh; overflow-y: auto; border: 1px solid #374151; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                <div style="padding: 20px; border-bottom: 1px solid #374151; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: #1f2937; z-index: 10;">
                    <h2 style="margin: 0; color: #f3f4f6; font-size: 20px;">⚙️ Настройки Auto-Apply v${SCRIPT_VERSION} (Multi-AI)</h2>
                    <button id="hh-close-settings" style="background: transparent; border: none; color: #9ca3af; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px;">&times;</button>
                </div>

                <div style="padding: 20px; display: flex; flex-direction: column; gap: 20px;">
                    <div style="background: #111827; padding: 16px; border-radius: 8px; border: 1px solid #374151;">
                        <label style="display: block; color: #a78bfa; font-weight: 600; margin-bottom: 8px; font-size: 14px;">📄 Управление списком резюме</label>
                        <p style="color: #9ca3af; font-size: 12px; margin-bottom: 12px;">Добавьте названия резюме, которые вы используете на hh.ru.</p>
                        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                            <input type="text" id="hh-new-resume-input" placeholder="Введите название нового резюме..."
                                style="flex: 1; background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 6px; padding: 8px 12px; font-size: 13px; box-sizing: border-box;" />
                            <button id="hh-add-resume-btn" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; white-space: nowrap;">➕ Добавить</button>
                        </div>
                        <div id="hh-resume-list-container" style="max-height: 200px; overflow-y: auto;"></div>
                    </div>

                    <div style="background: #111827; padding: 16px; border-radius: 8px; border: 1px solid #374151;">
                        <label style="display: block; color: #f59e0b; font-weight: 600; margin-bottom: 8px; font-size: 14px;">🤖 Выбор ИИ-провайдера</label>
                        <p style="color: #9ca3af; font-size: 12px; margin-bottom: 12px;">Кликните на карточку провайдера для выбора.</p>

                       <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;" id="hh-provider-cards-container">
                            ${Object.entries(AI_PROVIDERS).map(([key, info]) => `
                                <div id="hh-provider-card-${key}"
                                    data-provider="${key}"
                                    style="background: ${CONFIG.aiProvider === key ? '#374151' : '#1f2937'}; border: ${CONFIG.aiProvider === key ? '2px solid #f59e0b' : '1px solid #374151'}; border-radius: 8px; padding: 12px; cursor: pointer; text-align: center; transition: all 0.2s;">
                                    <div style="font-size: 24px; margin-bottom: 4px;">${info.icon}</div>
                                    <div style="color: #f3f4f6; font-size: 12px; font-weight: 600;">${info.name}</div>
                                </div>
                            `).join('')}
                        </div>

                        <div id="hh-provider-api-sections">
                            ${providerSections}
                        </div>
                    </div>

                    <div style="background: #111827; padding: 16px; border-radius: 8px; border: 1px solid #374151;">
                        <label style="display: block; color: #60a5fa; font-weight: 600; margin-bottom: 8px; font-size: 14px;">👤 Ваш профессиональный профиль (для ИИ)</label>
                        <p style="color: #9ca3af; font-size: 12px; margin-bottom: 8px;">Это описание будет использоваться ИИ для генерации сопроводительных писем.</p>
                        <textarea id="hh-user-profile" style="width: 100%; min-height: 150px; background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 6px; padding: 12px; font-family: inherit; font-size: 13px; resize: vertical; box-sizing: border-box;">${escapeHtml(USER_PROFILE)}</textarea>
                    </div>

                    <div style="background: #111827; padding: 16px; border-radius: 8px; border: 1px solid #374151;">
                        <label style="display: block; color: #34d399; font-weight: 600; margin-bottom: 8px; font-size: 14px;">📝 Шаблон сопроводительного письма (резервный)</label>
                        <p style="color: #9ca3af; font-size: 12px; margin-bottom: 8px;">Используется когда ИИ недоступен. Плейсхолдеры: {vacancy_title}, {company_name}</p>
                        <textarea id="hh-cover-letter-template" style="width: 100%; min-height: 120px; background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 6px; padding: 12px; font-family: inherit; font-size: 13px; resize: vertical; box-sizing: border-box;">${escapeHtml(CONFIG.coverLetterTemplate)}</textarea>
                    </div>

                    <div style="background: #111827; padding: 16px; border-radius: 8px; border: 1px solid #374151;">
                        <label style="display: block; color: #f59e0b; font-weight: 600; margin-bottom: 12px; font-size: 14px;">⚙️ Общие настройки ИИ</label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <div>
                                <label style="display: block; color: #d1d5db; font-size: 13px; margin-bottom: 6px;">
                                    Креативность (Temperature): <span id="hh-temp-value" style="color: #60a5fa;">${CONFIG.aiTemperature}</span>
                                </label>
                                <input type="range" id="hh-ai-temperature" min="0" max="1" step="0.1" value="${CONFIG.aiTemperature}" style="width: 100%;" />
                                <p style="color: #6b7280; font-size: 11px; margin-top: 4px;">0 = точно, 1 = креативно</p>
                            </div>
                            <div>
                                <label style="display: block; color: #d1d5db; font-size: 13px; margin-bottom: 6px;">
                                    Макс. длина (tokens): <span id="hh-tokens-value" style="color: #60a5fa;">${CONFIG.aiMaxTokens}</span>
                                </label>
                                <input type="range" id="hh-ai-tokens" min="400" max="2000" step="100" value="${CONFIG.aiMaxTokens}" style="width: 100%;" />
                                <p style="color: #6b7280; font-size: 11px; margin-top: 4px;">Рекомендуется: 800-1200 (русский текст «дороже» в токенах)</p>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end; padding-top: 8px;">
                        <button id="hh-reset-defaults" style="background: #374151; color: #f3f4f6; border: 1px solid #4b5563; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;">🔄 Сбросить</button>
                        <button id="hh-save-settings" style="background: #10b981; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">💾 Сохранить настройки</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(settingsModal);

               renderResumeListInSettings();

        // Инициализация правильного выделения при открытии
        switchProvider(CONFIG.aiProvider);

        // ИСПРАВЛЕНИЕ: Назначаем обработчики клика через addEventListener
        Object.keys(AI_PROVIDERS).forEach(key => {
            const card = document.getElementById(`hh-provider-card-${key}`);
            if (card) {
                card.addEventListener('click', () => {
                    switchProvider(key);
                });
                // Добавляем визуальный feedback при наведении
                card.addEventListener('mouseenter', () => {
                    if (CONFIG.aiProvider !== key) {
                        card.style.background = '#2d3748';
                    }
                });
                card.addEventListener('mouseleave', () => {
                    if (CONFIG.aiProvider !== key) {
                        card.style.background = '#1f2937';
                    }
                });
            }
        });

        document.getElementById('hh-close-settings').addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });

        document.getElementById('hh-add-resume-btn').addEventListener('click', () => {
            const input = document.getElementById('hh-new-resume-input');
            const newResume = input.value.trim();
            if (addResume(newResume)) {
                input.value = '';
                renderResumeListInSettings();
                updateResumeSelect();
                addLog('info', 'System', 'Resume', '-', `✅ Добавлено резюме: ${newResume}`);
            } else {
                alert('Введите уникальное название резюме!');
            }
        });

        document.getElementById('hh-new-resume-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('hh-add-resume-btn').click();
        });

        document.getElementById('hh-ai-temperature').addEventListener('input', (e) => {
            document.getElementById('hh-temp-value').textContent = e.target.value;
        });

        document.getElementById('hh-ai-tokens').addEventListener('input', (e) => {
            document.getElementById('hh-tokens-value').textContent = e.target.value;
        });

        document.getElementById('hh-save-settings').addEventListener('click', () => {
            USER_PROFILE = document.getElementById('hh-user-profile').value;
            GM_setValue('autoApplyUserProfile', USER_PROFILE);

            CONFIG.coverLetterTemplate = document.getElementById('hh-cover-letter-template').value;
            GM_setValue('autoApplyCoverLetterTemplate', CONFIG.coverLetterTemplate);

            // Сохраняем текущего провайдера
            GM_setValue('autoApplyAiProvider', CONFIG.aiProvider);

            Object.keys(AI_PROVIDERS).forEach(key => {
                const apiKeyInput = document.getElementById(`hh-${key}-api-key`);
                const modelSelect = document.getElementById(`hh-${key}-model`);
                if (apiKeyInput) {
                    CONFIG[key + 'ApiKey'] = apiKeyInput.value;
                    GM_setValue(`autoApply${key.charAt(0).toUpperCase() + key.slice(1)}ApiKey`, apiKeyInput.value);
                }
                if (modelSelect) {
                    CONFIG[key + 'Model'] = modelSelect.value;
                    GM_setValue(`autoApply${key.charAt(0).toUpperCase() + key.slice(1)}Model`, modelSelect.value);
                }
            });

            CONFIG.aiTemperature = parseFloat(document.getElementById('hh-ai-temperature').value);
            CONFIG.aiMaxTokens = parseInt(document.getElementById('hh-ai-tokens').value);
            GM_setValue('autoApplyAiTemperature', CONFIG.aiTemperature);
            GM_setValue('autoApplyAiMaxTokens', CONFIG.aiMaxTokens);

            addLog('info', 'System', 'Settings', '-', `✅ Настройки сохранены. ИИ: ${AI_PROVIDERS[CONFIG.aiProvider].icon} ${AI_PROVIDERS[CONFIG.aiProvider].name} (${CONFIG[CONFIG.aiProvider + 'Model']})`);

            const btn = document.getElementById('hh-save-settings');
            const originalText = btn.textContent;
            btn.textContent = '✓ Сохранено!';
            btn.style.background = '#059669';

            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '#10b981';
                settingsModal.style.display = 'none';
                updatePanelUI();
            }, 1000);
        });

        document.getElementById('hh-reset-defaults').addEventListener('click', () => {
            if (confirm('Сбросить все настройки к значениям по умолчанию?')) {
                document.getElementById('hh-user-profile').value = `PMP сертифицированный руководитель проектов с 10+ летним опытом управления IT-программами в международных корпорациях:
- Alcoa (аэрокосмический сектор, ключевой поставщик Boeing)
- Nestle (портфель 30+ digital-проектов, бюджет 150+ млн руб)
- Северсталь Tech Lab (Industrial AI, успешный вывод CV-систем в production)
Опыт параллельного ведения масштабных программ, управление стейкхолдерами, повышение velocity команды на 20% после Scrum-трансформации. Свободный английский, паспорт ЕС, полная готовность к релокации.`;
                document.getElementById('hh-cover-letter-template').value = "Здравствуйте!\n\nМеня очень заинтересовала ваша вакансия \"{vacancy_title}\" в компании \"{company_name}\".\n\nЯ — сертифицированный руководитель проектов (PMP) с более чем 10-летним опытом управления IT-программами в крупнейших международных корпорациях (Alcoa, Nestle, Северсталь Тех Лаб). Имею опыт внедрения Industrial AI, управления портфелем из 30+ проектов и повышения velocity команды на 20%.\n\nОбладаю паспортом ЕС, свободным английским и полностью готов к релокации.\n\nБуду рад обсудить подробности на собеседовании!\n\nС уважением,\nКандидат";
                document.getElementById('hh-ai-temperature').value = 0.7;
                document.getElementById('hh-temp-value').textContent = '0.7';
                document.getElementById('hh-ai-tokens').value = 1000;
                document.getElementById('hh-tokens-value').textContent = '1000';
                RESUME_LIST = [...DEFAULT_RESUMES];
                saveResumeList();
                renderResumeListInSettings();
                updateResumeSelect();
            }
        });

        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) settingsModal.style.display = 'none';
        });
    }

    let panelElement = null;

    function initUI() {
        if (document.getElementById('hh-auto-apply-panel')) return;

        panelElement = document.createElement('div');
        panelElement.id = 'hh-auto-apply-panel';
        panelElement.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 380px; max-height: 720px;
            overflow-y: auto; background: #111827; color: #f3f4f6; border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px; z-index: 99999; border: 1px solid #374151; display: flex;
            flex-direction: column; overflow: hidden; transition: all 0.3s ease;
        `;

        const currentProvider = AI_PROVIDERS[CONFIG.aiProvider];
        const currentModel = CONFIG[CONFIG.aiProvider + 'Model'];

        panelElement.innerHTML = `
            <div style="background: #1f2937; padding: 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #374151; cursor: move;" id="hh-panel-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: #ef4444; width: 8px; height: 8px; border-radius: 50%; display: inline-block;" id="hh-status-indicator"></span>
                    <strong style="font-size: 14px;">HH Auto-Apply v${SCRIPT_VERSION}</strong>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="hh-btn-settings" style="background: #374151; border: 1px solid #4b5563; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">⚙️ Настройки</button>
                    <button id="hh-toggle-minimize" style="background: #374151; border: 1px solid #4b5563; color: white; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">_</button>
                    <button id="hh-btn-reset" style="background: #374151; border: 1px solid #4b5563; color: white; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">Сброс</button>
                </div>
            </div>

            <div style="padding: 12px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; flex: 1;" id="hh-panel-body">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; background: #1f2937; padding: 10px; border-radius: 8px;">
                    <div><div style="color: #9ca3af; font-size: 10px; text-transform: uppercase;">Scanned</div><strong id="hh-stat-scanned" style="font-size: 16px; color: #60a5fa;">0</strong></div>
                    <div><div style="color: #9ca3af; font-size: 10px; text-transform: uppercase;">Applied</div><strong id="hh-stat-applied" style="font-size: 16px; color: #10b981;">0</strong></div>
                    <div><div style="color: #9ca3af; font-size: 10px; text-transform: uppercase;">Skipped</div><strong id="hh-stat-skipped" style="font-size: 16px; color: #f87171;">0</strong></div>
                </div>

                <div style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px;">
                    <div style="font-weight: 600; margin-bottom: 6px; color: #818cf8;">⚙️ Текущие настройки:</div>
                    <div style="display: flex; flex-direction: column; gap: 4px; color: #d1d5db;">
                        <div>🤖 <strong>ИИ:</strong> <span style="color: #fbbf24;" id="hh-active-ai-display">${currentProvider.icon} ${currentProvider.name} (${currentModel})</span></div>
                        <div>📄 <strong>Резюме:</strong> <span style="color: #60a5fa;" id="hh-active-resume-text">${escapeHtml(CONFIG.selectedResumeTitle)}</span></div>
                        <div>✉️ <strong>Письмо:</strong> <span style="color: #34d399;" id="hh-active-mode-text">${CONFIG.coverLetterMode === 'ai' ? 'Умный ИИ' : 'Статический шаблон'}</span></div>
                        <div>🎯 <strong>Лимит:</strong> ${CONFIG.applyLimit} откликов</div>
                    </div>
                </div>

                <div style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-weight: 600; color: #818cf8;">✉️ Режим сопроводительного письма:</label>
                    <select id="hh-select-mode" style="background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 4px; padding: 4px; outline: none; width: 100%; cursor: pointer;">
                        <option value="ai" ${CONFIG.coverLetterMode === 'ai' ? 'selected' : ''}>Умный ИИ (анализ описания вакансии)</option>
                        <option value="template" ${CONFIG.coverLetterMode === 'template' ? 'selected' : ''}>Статический шаблон</option>
                    </select>
                </div>

                <div id="hh-template-panel" style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px; display: ${CONFIG.coverLetterMode === 'template' ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                    <label style="font-weight: 600; color: #34d399;"> Шаблон письма:</label>
                    <textarea id="hh-template-input" style="background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 4px; padding: 6px; outline: none; width: 100%; min-height: 80px; font-family: inherit; resize: vertical;"></textarea>
                </div>

                <div id="hh-active-ai-panel" style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px; display: ${CONFIG.coverLetterMode === 'ai' ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                    <label class="hh-ai-provider-label" style="font-weight: 600; color: #f59e0b;">🤖 Активный ИИ: ${currentProvider.icon} ${currentProvider.name}</label>
                    <span class="hh-ai-model-span" style="color: #9ca3af; font-size: 10px;">Модель: ${currentModel}</span>
                    <span style="color: #9ca3af; font-size: 10px;">Нажмите "⚙️ Настройки" для смены провайдера и API ключей</span>
                </div>

                <div style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-weight: 600; color: #818cf8;">📄 Резюме для отклика:</label>
                    <select id="hh-select-resume" style="background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 4px; padding: 4px; outline: none; width: 100%; cursor: pointer;"></select>
                </div>

                <div style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-weight: 600; color: #fbbf24;">❓ При вопросах работодателя:</label>
                    <select id="hh-select-questions" style="background: #374151; color: #f3f4f6; border: 1px solid #4b5563; border-radius: 4px; padding: 4px; outline: none; width: 100%; cursor: pointer;">
                        <option value="notify" ${CONFIG.questionsAction === 'notify' ? 'selected' : ''}>Просить вмешаться (звук + пауза)</option>
                        <option value="skip" ${CONFIG.questionsAction === 'skip' ? 'selected' : ''}>Пропускать такие вакансии</option>
                    </select>
                </div>

                <div style="background: #1f2937; padding: 10px; border-radius: 8px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <label style="font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 4px; cursor: pointer;" for="hh-check-region">
                        🌍 Подтверждать переезд / др. регион
                    </label>
                    <input type="checkbox" id="hh-check-region" ${CONFIG.autoConfirmRegion ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px;" />
                </div>

                <button id="hh-btn-toggle" style="background: #10b981; color: white; border: none; font-weight: bold; font-size: 14px; padding: 12px; border-radius: 8px; cursor: pointer; transition: background 0.2s; width: 100%;">
                    RUN AUTO-APPLY
                </button>

                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="color: #9ca3af;">Log</strong>
                        <button id="hh-btn-export" style="background: transparent; border: none; color: #60a5fa; cursor: pointer; text-decoration: underline; font-size: 11px;">Export CSV</button>
                    </div>
                    <div id="hh-log-console" style="background: #000; height: 110px; padding: 6px; border-radius: 6px; font-family: monospace; font-size: 10px; overflow-y: auto; border: 1px solid #374151; color: #34d399; line-height: 1.4;"></div>
                </div>
            </div>
        `;

        document.body.appendChild(panelElement);
        updateResumeSelect();

        document.getElementById('hh-btn-toggle').addEventListener('click', toggleScriptState);
        document.getElementById('hh-btn-reset').addEventListener('click', resetScriptStats);
        document.getElementById('hh-btn-export').addEventListener('click', exportLogsToCSV);
        document.getElementById('hh-toggle-minimize').addEventListener('click', toggleMinimize);
        document.getElementById('hh-btn-settings').addEventListener('click', openSettingsModal);

        document.getElementById('hh-select-resume').addEventListener('change', (e) => {
            CONFIG.selectedResumeTitle = e.target.value;
            GM_setValue('autoApplySelectedResume', e.target.value);
            document.getElementById('hh-active-resume-text').textContent = e.target.value;
            addLog('info', 'System', 'Resume', '-', `Выбрано резюме: ${e.target.value}`);
        });

        document.getElementById('hh-select-mode').addEventListener('change', (e) => {
            CONFIG.coverLetterMode = e.target.value;
            GM_setValue('autoApplyCoverLetterMode', e.target.value);
            document.getElementById('hh-template-panel').style.display = e.target.value === 'template' ? 'flex' : 'none';
            document.getElementById('hh-active-ai-panel').style.display = e.target.value === 'ai' ? 'flex' : 'none';
            document.getElementById('hh-active-mode-text').textContent = e.target.value === 'ai' ? 'Умный ИИ' : 'Статический шаблон';
        });

        document.getElementById('hh-template-input').value = CONFIG.coverLetterTemplate;
        document.getElementById('hh-template-input').addEventListener('input', (e) => {
            CONFIG.coverLetterTemplate = e.target.value;
            GM_setValue('autoApplyCoverLetterTemplate', e.target.value);
        });

        document.getElementById('hh-select-questions').addEventListener('change', (e) => {
            CONFIG.questionsAction = e.target.value;
            GM_setValue('autoApplyQuestionsAction', e.target.value);
        });

        document.getElementById('hh-check-region').addEventListener('change', (e) => {
            CONFIG.autoConfirmRegion = e.target.checked;
            GM_setValue('autoApplyAutoConfirmRegion', e.target.checked);
        });

        dragElement(panelElement, document.getElementById('hh-panel-header'));
        updatePanelUI();
    }

    let isMinimized = false;
    function toggleMinimize() {
        const body = document.getElementById('hh-panel-body');
        const toggleBtn = document.getElementById('hh-toggle-minimize');
        isMinimized = !isMinimized;
        body.style.display = isMinimized ? 'none' : 'flex';
        toggleBtn.textContent = isMinimized ? '▢' : '_';
        panelElement.style.maxHeight = isMinimized ? '40px' : '720px';
    }

    function toggleScriptState() {
        state.active = !state.active;
        saveState();
        if (state.active) {
            addLog('info', 'System', 'Engine', '-', `Smart Auto-Apply v${SCRIPT_VERSION} started (ИИ: ${AI_PROVIDERS[CONFIG.aiProvider].name})`);
            runScannerLifecycle();
        } else {
            addLog('info', 'System', 'Engine', '-', 'Auto-Apply paused');
        }
    }

    function resetScriptStats() {
        if (confirm('Сбросить статистику и логи?')) {
            state.scanned = 0; state.applied = 0; state.skipped = 0; state.logs = [];
            saveState();
        }
    }

    function updatePanelUI() {
        if (!panelElement) return;
        const btnToggle = document.getElementById('hh-btn-toggle');
        const indicator = document.getElementById('hh-status-indicator');
        if (state.active) {
            btnToggle.textContent = 'PAUSE AUTO-APPLY';
            btnToggle.style.background = '#dc2626';
            indicator.style.background = '#10b981';
        } else {
            btnToggle.textContent = 'RUN AUTO-APPLY';
            btnToggle.style.background = '#10b981';
            indicator.style.background = '#ef4444';
        }
        document.getElementById('hh-stat-scanned').textContent = state.scanned;
        document.getElementById('hh-stat-applied').textContent = state.applied;
        document.getElementById('hh-stat-skipped').textContent = state.skipped;

        const currentProvider = AI_PROVIDERS[CONFIG.aiProvider];
        const currentModel = CONFIG[CONFIG.aiProvider + 'Model'];

        const activeAiDisplay = document.getElementById('hh-active-ai-display');
        if (activeAiDisplay) activeAiDisplay.textContent = `${currentProvider.icon} ${currentProvider.name} (${currentModel})`;

        const activeResumeText = document.getElementById('hh-active-resume-text');
        if (activeResumeText) activeResumeText.textContent = CONFIG.selectedResumeTitle;

        const activeAiPanel = document.getElementById('hh-active-ai-panel');
        if (activeAiPanel && CONFIG.coverLetterMode === 'ai') {
            const providerLabel = activeAiPanel.querySelector('.hh-ai-provider-label');
            const modelSpan = activeAiPanel.querySelector('.hh-ai-model-span');
            if (providerLabel) providerLabel.innerHTML = `🤖 Активный ИИ: ${currentProvider.icon} ${currentProvider.name}`;
            if (modelSpan) modelSpan.textContent = `Модель: ${currentModel}`;
        }

        const consoleEl = document.getElementById('hh-log-console');
        if (consoleEl) {
            consoleEl.innerHTML = state.logs.map(log => {
                let color = '#34d399';
                if (log.status === 'applied') color = '#10b981';
                if (log.status === 'skipped') color = '#f87171';
                if (log.status === 'matched') color = '#60a5fa';
                return `<div style="margin-bottom: 4px; color: ${color};">[${escapeHtml(log.timestamp)}] ${escapeHtml(log.status.toUpperCase())}: ${escapeHtml(log.title)} - ${escapeHtml(log.reason || 'processed')}</div>`;
            }).join('') || '<div style="color: #6b7280; text-align: center; margin-top: 20px;">Нет записей</div>';
        }
    }

    function dragElement(elmnt, header) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        header.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
            elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
            elmnt.style.bottom = "auto"; elmnt.style.right = "auto";
        }
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
        }
    }

    async function runScannerLifecycle() {
        if (!state.active) return;
        if (state.applied >= CONFIG.applyLimit) {
            addLog('info', 'System', 'Engine', '-', 'Лимит достигнут! Остановка.');
            state.active = false; saveState(); return;
        }

        const cards = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"], [data-qa="serp-item"], .serp-item, .vacancy-card');
        if (cards.length === 0) {
            setTimeout(() => { if (state.active) runScannerLifecycle(); }, 5000);
            return;
        }

        for (let i = 0; i < cards.length; i++) {
            if (!state.active) return;
            const card = cards[i];
            if (card.dataset.hhAutoScanned === 'true') continue;
            card.dataset.hhAutoScanned = 'true';

            state.scanned++; saveState();

            const titleEl = card.querySelector('[data-qa="serp-item__title"], [data-qa="vacancy-serp__vacancy-title"], .serp-item__title, a.bloko-link, [data-qa="vacancy-card-title"]');
            const title = titleEl ? titleEl.textContent.trim() : 'Vacancy';
            const companyEl = card.querySelector('[data-qa="vacancy-serp__vacancy-employer"], .vacancy-serp-item__meta-info-company, [data-qa="serp-item__employer"], [data-qa="vacancy-card-employer"]');
            const company = companyEl ? companyEl.textContent.replace(/\s+/g, ' ').trim() : 'Employer';
            const salaryEl = card.querySelector('[data-qa="vacancy-serp__vacancy-compensation"], .vacancy-serp-item__sidebar, [data-qa="serp-item__compensation"], [data-qa="vacancy-card-compensation"]');
            const salary = salaryEl ? salaryEl.textContent.trim() : 'Not Specified';

            card.style.border = '2px solid rgba(16, 185, 129, 0.8)';
            card.style.background = 'rgba(16, 185, 129, 0.05)';
            card.style.position = 'relative';

            const badge = document.createElement('div');
            badge.style.cssText = 'background: #10b981; color: white; padding: 2px 6px; font-size: 10px; font-weight: bold; position: absolute; border-radius: 4px; top: -10px; left: 10px; z-index: 10;';
            badge.textContent = 'SMART MATCH';
            card.insertBefore(badge, card.firstChild);

            const applyBtn = card.querySelector('[data-qa="vacancy-serp__vacancy_response"], [data-qa="serp-item__response"], .vacancy-serp-actions a, button.bloko-button_primary, [data-qa="vacancy-card-response-button"]');

            if (applyBtn) {
                const buttonText = applyBtn.textContent.trim().toLowerCase();
                if (buttonText.includes('вы откликнулись') || buttonText.includes('сообщение отправлено')) {
                    addLog('skipped', title, company, salary, 'Уже откликнулись');
                    state.skipped++; saveState(); continue;
                }

                const delay = Math.floor(Math.random() * (CONFIG.delayMaxMs - CONFIG.delayMinMs + 1) + CONFIG.delayMinMs);
                addLog('matched', title, company, salary, `Анализ и отклик через ${(delay/1000).toFixed(1)}с...`);
                await new Promise(resolve => setTimeout(resolve, delay));

                if (!state.active) return;

                // Раньше брался первый a.bloko-link, которым часто оказывалась ссылка на работодателя,
                // и ИИ получал описание компании вместо вакансии (или ничего).
                const vacancyLink = card.querySelector('a[data-qa="serp-item__title"]') ||
                    Array.from(card.querySelectorAll('a[href*="/vacancy/"]')).find(a => getVacancyId(a.href));
                const vacancyUrl = vacancyLink ? vacancyLink.href : null;

                // Письмо готовим ДО открытия формы: генерация может занять десятки секунд
                // и не должна съедать таймаут модального окна.
                const coverLetter = await prepareCoverLetter(title, company, vacancyUrl);
                if (!state.active) return;

                applyBtn.click();
                addLog('info', title, company, salary, 'Открытие формы отклика...');

                await handleResponseModalLifecycle(title, company, coverLetter);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                addLog('skipped', title, company, salary, 'Кнопка отклика не найдена');
                state.skipped++; saveState();
            }
        }
        addLog('info', 'Page Scan', 'Engine', '-', 'Страница обработана.');
    }

    async function prepareCoverLetter(jobTitle, companyName, vacancyUrl) {
        if (CONFIG.coverLetterMode !== 'ai') return fillTemplate(jobTitle, companyName);

        const currentApiKey = CONFIG[CONFIG.aiProvider + 'ApiKey'];
        if (!currentApiKey) {
            addLog('info', jobTitle, companyName, '-', `⚠️ API ключ ${AI_PROVIDERS[CONFIG.aiProvider].name} не указан. Использую шаблон.`);
            return fillTemplate(jobTitle, companyName);
        }

        addLog('info', jobTitle, companyName, '-', '📥 Загрузка описания вакансии...');
        const description = await fetchVacancyDescription(vacancyUrl);
        if (!description) {
            addLog('info', jobTitle, companyName, '-', '⚠️ Описание не получено — письмо будет только по названию вакансии');
        }

        const aiLetter = await generateAICoverLetter(jobTitle, companyName, description);
        if (aiLetter) {
            addLog('info', jobTitle, companyName, '-', '✅ Письмо под вакансию сгенерировано');
            return aiLetter;
        }
        addLog('info', jobTitle, companyName, '-', '⚠️ Ошибка ИИ. Использую шаблон.');
        return fillTemplate(jobTitle, companyName);
    }

    async function handleResponseModalLifecycle(jobTitle, companyName, preparedLetter) {
        const MODAL_TIMEOUT = 60000;
        const startTime = Date.now();

        return new Promise((resolve) => {
            let attempt = 0;
            let hasConfirmedRegion = false;
            let hasSelectedResume = false;
            let hasClickedCoverLetterButton = false;
            let hasToggledLetter = false;
            let hasWrittenLetter = false;
            let hasSubmitted = false;
            let isProcessingTick = false;
            let letterWriteAttempts = 0;
            let ticksWithoutModal = 0;
            let timeoutWarningShown = false;

            function findActiveModal() {
                let m = document.querySelector('[data-qa="vacancy-response-popup"]');
                if (m) return m;
                const knownButtons = document.querySelectorAll('[data-qa="vacancy-response-submit-button"], [data-qa="relocation-warning-confirm"], [data-qa="vacancy-response-letter-toggle"], [data-qa="vacancy-response-letter-add"]');
                for (const btn of knownButtons) {
                    const parent = btn.closest('.bloko-modal, [role="dialog"], div[class*="modal"], div[class*="popup"], div[class*="magritte-modal"]');
                    if (parent) return parent;
                }
                const selectors = ['.bloko-modal', '[role="dialog"]', 'div[class*="bloko-modal"]', 'div[class*="modal-container"]', 'div[class*="popup"]', 'div[class*="Modal"]', 'div[class*="Popup"]', 'div[class*="magritte-modal"]'];
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                        const rect = el.getBoundingClientRect();
                        if (rect.height > 50 && rect.width > 50) {
                            const textLower = (el.textContent || "").toLowerCase();
                            if (textLower.includes("отклик на вакансию") || textLower.includes("откликаетесь на вакансию") || textLower.includes("все равно откликнуться") || textLower.includes("добавить сопроводительное") || el.querySelector('[data-qa="relocation-warning-confirm"]') || el.querySelector('[data-qa="vacancy-response-submit-button"]')) {
                                return el;
                            }
                        }
                    }
                }
                if (document.querySelector('[data-qa="relocation-warning-confirm"], [data-qa="vacancy-response-submit-button"]')) return document.body;
                return null;
            }

            function findLetterTextarea(modal) {
                return modal.querySelector('textarea[data-qa*="letter"], textarea[name*="letter"], textarea.bloko-textarea, .vacancy-response-letter-input textarea') || modal.querySelector('textarea');
            }

            function alertUser(message) {
                addLog('info', jobTitle, companyName, '-', `⚠️ ${message}`);
                const header = document.getElementById('hh-panel-header');
                if (header) {
                    header.style.background = '#dc2626';
                    const headerTitle = header.querySelector('strong');
                    if (headerTitle) headerTitle.textContent = '️ ТРЕБУЕТСЯ ВНИМАНИЕ!';
                }
                try {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    for (let i = 0; i < 3; i++) {
                        setTimeout(() => {
                            const osc = audioCtx.createOscillator();
                            const gain = audioCtx.createGain();
                            osc.connect(gain); gain.connect(audioCtx.destination);
                            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
                            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
                            osc.start(); osc.stop(audioCtx.currentTime + 0.2);
                        }, i * 300);
                    }
                } catch(e) {}
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("HH Auto-Apply: Требуется внимание", { body: message });
                }
            }

            const checkInterval = setInterval(async () => {
                const elapsed = Date.now() - startTime;
                if (elapsed > MODAL_TIMEOUT) {
                    clearInterval(checkInterval);
                    alertUser(`Превышен таймаут (${MODAL_TIMEOUT/1000}с). Процесс прерван.`);
                    state.skipped++; saveState();
                    resolve(false);
                    return;
                }
                if (elapsed > 30000 && !timeoutWarningShown) {
                    timeoutWarningShown = true;
                    alertUser(`Процесс затянулся (${Math.floor(elapsed/1000)}с). Проверьте страницу!`);
                }

                if (isProcessingTick) return;
                isProcessingTick = true;

                try {
                    attempt++;
                    const modal = findActiveModal();

                    if (modal) {
                        attempt = 0;
                        ticksWithoutModal = 0;
                        const modalTextLower = (modal.textContent || "").toLowerCase();

                        const isRelocationModal = !hasConfirmedRegion && (modalTextLower.includes("откликаетесь на вакансию в другой стране") || modalTextLower.includes("откликаетесь на вакансию в другом регионе") || modalTextLower.includes("все равно откликнуться") || !!modal.querySelector('[data-qa="relocation-warning-confirm"]'));
                        if (isRelocationModal) {
                            if (CONFIG.autoConfirmRegion) {
                                let confirmBtn = modal.querySelector('[data-qa="relocation-warning-confirm"], .bloko-button_primary, button.bloko-button_primary');
                                if (!confirmBtn) {
                                    const buttons = modal.querySelectorAll('button, [class*="button"], .bloko-button, a');
                                    for (const btn of buttons) {
                                        if ((btn.textContent || "").includes("Все равно")) { confirmBtn = btn; break; }
                                    }
                                }
                                if (confirmBtn) {
                                    addLog('info', jobTitle, companyName, '-', ' Авто-подтверждение региона...');
                                    confirmBtn.click();
                                    hasConfirmedRegion = true;
                                    await new Promise(r => setTimeout(r, 1500));
                                }
                            } else {
                                addLog('skipped', jobTitle, companyName, '-', '⚠️ Пропуск: другой регион');
                                const closeBtn = modal.querySelector('[data-qa="modal-close"], [class*="close"], .bloko-modal-close-button');
                                if (closeBtn) closeBtn.click();
                                state.skipped++; saveState();
                                clearInterval(checkInterval);
                                setTimeout(() => resolve(false), 1000);
                                return;
                            }
                            return;
                        }

                        let hasQuestions = !!modal.querySelector('[data-qa="vacancy-response-questions"], .vacancy-response-questions, [class*="questions-wrapper"]');
                        if (!hasQuestions) {
                            const textareas = modal.querySelectorAll('textarea');
                            if (textareas.length > 1) hasQuestions = true;
                            else if (textareas.length === 1) {
                                const ta = textareas[0];
                                const taDataQa = (ta.getAttribute('data-qa') || "").toLowerCase();
                                const taName = (ta.getAttribute('name') || "").toLowerCase();
                                const isLetter = taDataQa.includes('letter') || taName.includes('letter') || ta.className.includes('letter');
                                if (!isLetter && (taDataQa.includes('question') || taName.includes('question') || taDataQa.includes('test') || taName.includes('test'))) hasQuestions = true;
                            }
                        }

                        if (hasQuestions) {
                            if (CONFIG.questionsAction === 'skip') {
                                addLog('skipped', jobTitle, companyName, '-', '⚠️ Пропуск: есть вопросы работодателя');
                                const closeBtn = modal.querySelector('[data-qa="modal-close"], [class*="close"], .bloko-modal-close-button');
                                if (closeBtn) closeBtn.click();
                                state.skipped++; saveState();
                                clearInterval(checkInterval);
                                setTimeout(() => resolve(false), 1000);
                                return;
                            } else {
                                alertUser('ТРЕБУЮТСЯ ОТВЕТЫ НА ВОПРОСЫ РАБОТОДАТЕЛЯ!');
                                clearInterval(checkInterval);
                                const modalCheck = setInterval(() => {
                                    if (!findActiveModal()) {
                                        clearInterval(modalCheck);
                                        const hdr = document.getElementById('hh-panel-header');
                                        if (hdr) {
                                            hdr.style.background = '#1f2937';
                                            const headerTitle = hdr.querySelector('strong');
                                            if (headerTitle) headerTitle.textContent = `HH Auto-Apply v${SCRIPT_VERSION}`;
                                        }
                                        addLog('info', jobTitle, companyName, '-', 'Продолжаю сканирование...');
                                        resolve(true);
                                    }
                                }, 1000);
                                return;
                            }
                        }

                        if (!hasSelectedResume) {
                            try {
                                let selected = false;
                                const nativeSelect = modal.querySelector('select');
                                if (nativeSelect) {
                                    for (let opt of nativeSelect.querySelectorAll('option')) {
                                        if (opt.textContent && opt.textContent.toLowerCase().includes(CONFIG.selectedResumeTitle.toLowerCase())) {
                                            nativeSelect.value = opt.value;
                                            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                                            selected = true; break;
                                        }
                                    }
                                }
                                if (!selected) {
                                    const resumeItems = modal.querySelectorAll('[data-qa="resume-select-item"], label, .bloko-radio, [class*="resume-select"]');
                                    for (let item of resumeItems) {
                                        if (item.textContent && item.textContent.toLowerCase().includes(CONFIG.selectedResumeTitle.toLowerCase())) {
                                            const input = item.querySelector('input[type="radio"], .bloko-radio__input');
                                            if (input) input.click(); else item.click();
                                            selected = true; break;
                                        }
                                    }
                                }
                                if (!selected) {
                                    const blokoSelect = modal.querySelector('.bloko-select, [data-qa="resume-select-container"], div[class*="select"]');
                                    if (blokoSelect) {
                                        blokoSelect.click();
                                        await new Promise(r => setTimeout(r, 400));
                                        for (let item of document.querySelectorAll('.bloko-select-dropdown-item, [class*="select-dropdown"] div, .bloko-dropdown-placeholder, [data-qa*="resume"]')) {
                                            if (item.textContent && item.textContent.toLowerCase().includes(CONFIG.selectedResumeTitle.toLowerCase())) {
                                                item.click(); selected = true; break;
                                            }
                                        }
                                    }
                                }
                            } catch (err) { console.error('Error selecting resume:', err); }
                            hasSelectedResume = true;
                            return;
                        }

                        if (!hasClickedCoverLetterButton && CONFIG.coverLetterMode !== 'none') {
                            let coverLetterButton = modal.querySelector('[data-qa="vacancy-response-letter-add"], [data-qa="vacancy-response-letter-toggle"]');
                            if (!coverLetterButton) {
                                const buttons = modal.querySelectorAll('button, a, span[role="button"], div[role="button"]');
                                for (const btn of buttons) {
                                    const txt = (btn.textContent || "").toLowerCase();
                                    if (txt.includes('добавить сопроводительное') || txt.includes('сопроводительное письмо') || txt.includes('cover letter')) {
                                        coverLetterButton = btn; break;
                                    }
                                }
                            }
                            if (coverLetterButton) {
                                addLog('info', jobTitle, companyName, '-', '📝 Нажимаю "Добавить сопроводительное"...');
                                coverLetterButton.click();
                                hasClickedCoverLetterButton = true;
                                await new Promise(r => setTimeout(r, 800));
                                return;
                            } else {
                                hasClickedCoverLetterButton = true;
                                hasToggledLetter = true;
                            }
                        }

                        if (hasClickedCoverLetterButton && !hasToggledLetter) {
                            const textarea = findLetterTextarea(modal);
                            if (textarea) {
                                hasToggledLetter = true;
                                addLog('info', jobTitle, companyName, '-', '✅ Поле письма найдено');
                            } else {
                                return;
                            }
                        }

                        if (hasToggledLetter && !hasWrittenLetter) {
                            let textarea = findLetterTextarea(modal);
                            if (textarea) {
                                const compiledLetter = preparedLetter || fillTemplate(jobTitle, companyName);
                                letterWriteAttempts++;

                                try {
                                    textarea.focus();
                                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                                    nativeInputValueSetter.call(textarea, compiledLetter);
                                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                                    textarea.dispatchEvent(new Event('change', { bubbles: true }));
                                    textarea.blur();
                                    addLog('info', jobTitle, companyName, '-', '✏️ Письмо вставлено');
                                } catch (err) {
                                    textarea.value = compiledLetter;
                                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            } else {
                                addLog('info', jobTitle, companyName, '-', '️ Поле письма не найдено');
                            }
                            hasWrittenLetter = true;
                            return;
                        }

                        if (hasWrittenLetter && !hasSubmitted) {
                            const textarea = findLetterTextarea(modal);
                            if (textarea && textarea.value.length < 10 && letterWriteAttempts < 3) {
                                addLog('info', jobTitle, companyName, '-', '️ Письмо не вставлено, пробую еще раз...');
                                hasWrittenLetter = false;
                                return;
                            }
                            let submitBtn = modal.querySelector('[data-qa="vacancy-response-submit-button"], .bloko-button_primary, .bloko-modal-footer button[class*="primary"]');
                            if (!submitBtn) {
                                for (const btn of modal.querySelectorAll('button, input[type="button"], input[type="submit"]')) {
                                    const txt = btn.textContent || "";
                                    if (txt.includes('Откликнуться') || txt.includes('откликнуться') || txt.includes('Отправить') || txt.includes('Submit') || txt.includes('Apply')) {
                                        submitBtn = btn; break;
                                    }
                                }
                            }
                            if (submitBtn) {
                                addLog('info', jobTitle, companyName, '-', ' Отправляю отклик...');
                                submitBtn.click();
                                hasSubmitted = true;
                                await new Promise(r => setTimeout(r, 1000));
                            } else {
                                addLog('info', jobTitle, companyName, '-', '⚠️ Кнопка отправки не найдена');
                            }
                        }
                    } else {
                        ticksWithoutModal++;
                        // После подтверждения региона форма появляется с задержкой — ждем ~3с, прежде чем считать отклик отправленным
                        if (hasSubmitted || (hasConfirmedRegion && ticksWithoutModal > 6)) {
                            clearInterval(checkInterval);
                            addLog('applied', jobTitle, companyName, '-', '✅ Отклик отправлен!');
                            state.applied++; saveState();
                            resolve(true);
                            return;
                        }
                        if (attempt > 40) {
                            clearInterval(checkInterval);
                            resolve(false);
                        }
                    }
                } catch (err) {
                    console.error("Error in modal processing tick:", err);
                } finally {
                    isProcessingTick = false;
                }
            }, 500);
        });
    }

    function exportLogsToCSV() {
        if (state.logs.length === 0) { alert('Нет логов для экспорта!'); return; }
        let csvContent = "data:text/csv;charset=utf-8,Timestamp,Status,Vacancy Title,Company,Salary,Details/Reason\n";
        state.logs.forEach(log => {
            const row = [log.timestamp, log.status, `"${log.title.replace(/"/g, '""')}"`, `"${log.company.replace(/"/g, '""')}"`, `"${log.salary.replace(/"/g, '""')}"`, `"${(log.reason || '').replace(/"/g, '""')}"`].join(",");
            csvContent += row + "\n";
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `hh_auto_apply_report_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    setTimeout(() => {
        initUI();
        // Состояние «активен» сохраняется между страницами — продолжаем работу после перехода/перезагрузки
        if (state.active) {
            addLog('info', 'System', 'Engine', '-', 'Продолжаю автоотклик на новой странице...');
            runScannerLifecycle();
        }
    }, 1500);
})();
