// Li-Mat Frontier RSS 抓取脚本
// 使用阿里通义千问API生成中文摘要

const Parser = require('rss-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================

// 阿里通义千问API配置
const QWEN_API_KEY = process.env.QWEN_API_KEY;

// RSS源配置（已验证可用）
const RSS_SOURCES = {
    '综合资讯': [
        'https://techcrunch.com/feed/',
        'https://www.theverge.com/rss/index.xml',
        'https://feeds.arstechnica.com/arstechnica/technology-lab',
        'https://www.wired.com/feed/rss',
        'https://venturebeat.com/feed/'
    ],
    '金属材料': [
        'https://chipsandcheese.com/feed/',
        'https://www.tomshardware.com/feeds/all',
        'https://www.eetimes.com/feed/'
    ],
    '非金属材料': [
        'https://www.technologyreview.com/feed/',
        'https://www.carbon-fiber.eu/feed/',
        'https://www.automotiveworld.com/feed/'
    ],
    '汽车防腐': [
        'https://www.european-coatings.com/rss',
        'https://www.automotiveworld.com/feed/'
    ],
    '车内健康': [
        'https://www.sustainablebrands.com/rss',
        'https://www.automotiveworld.com/feed/'
    ],
    '紧固件': [
        'https://www.automotiveworld.com/feed/'
    ],
    '环保合规': [
        'https://www.sustainablebrands.com/rss',
        'https://www.automotiveworld.com/feed/'
    ]
};

// ==================== 工具函数 ====================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
}

function isChinese(text) {
    if (!text) return false;
    return /[\u4e00-\u9fa5]/.test(text);
}

// ==================== RSS抓取（并行） ====================

async function fetchRSS(url, category) {
    const parser = new Parser({
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    try {
        console.log(`抓取: ${url}`);
        const feed = await parser.parseURL(url);

        const articles = feed.items.map(item => ({
            title: (item.title || '').trim(),
            link: (item.link || '').trim(),
            date: new Date(item.pubDate || item.isoDate || new Date()).toISOString(),
            category: category,
            description: stripHtml(item.contentSnippet || item.content || item.description || '').substring(0, 500),
            summary: ''
        }));

        console.log(`✓ ${url} - 成功 ${articles.length} 条`);
        return articles;
    } catch (error) {
        console.error(`✗ ${url} - 失败: ${error.message}`);
        return [];
    }
}

async function fetchAllRSS() {
    console.log('🚀 并行抓取RSS源...\n');

    const promises = [];
    for (const [category, urls] of Object.entries(RSS_SOURCES)) {
        console.log(`📥 ${category}`);
        promises.push(...urls.map(url => fetchRSS(url, category)));
        await delay(500);
    }

    const results = await Promise.allSettled(promises);

    const allArticles = [];
    let successCount = 0;
    let failCount = 0;

    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
            allArticles.push(...result.value);
            successCount++;
        } else {
            failCount++;
        }
    });

    return { allArticles, successCount, failCount };
}

// ==================== 阿里通义千问API ====================

async function generateSummaryWithQwen(text, retries = 3) {
    let apiKey = QWEN_API_KEY;

    if (!apiKey) {
        console.warn('⚠️  未配置通义千问API Key');
        return text.substring(0, 150) + '...';
    }

    // 清理API Key
    apiKey = apiKey.trim().replace(/[\r\n\t]/g, '');

    // 如果已经是中文，直接返回
    if (isChinese(text)) {
        return text.substring(0, 150) + '...';
    }

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'qwen-turbo',
                    input: {
                        messages: [
                            {
                                role: 'system',
                                content: '你是专业的汽车材料技术翻译专家。将英文内容翻译成中文并生成简洁的摘要（100字以内）。直接输出摘要，不要添加前缀。'
                            },
                            {
                                role: 'user',
                                content: `请翻译并生成摘要：\n\n${text.substring(0, 500)}`
                            }
                        ]
                    },
                    parameters: {
                        max_tokens: 200,
                        temperature: 0.3
                    }
                })
            });

            if (!response.ok) {
                const status = response.status;
                const errorText = await response.text();

                if ((status === 429 || status === 503) && attempt < retries - 1) {
                    const waitTime = Math.pow(2, attempt) * 3000;
                    console.log(`⚠️  API限流 (${status})，${waitTime/1000}秒后重试...`);
                    await delay(waitTime);
                    continue;
                }

                console.error(`通义千问API错误 (${status}): ${errorText.substring(0, 200)}`);
                return text.substring(0, 150) + '...';
            }

            const data = await response.json();

            if (data.output && data.output.text) {
                const summary = data.output.text.trim();
                return summary;
            }

            console.error('API返回格式错误');
            return text.substring(0, 150) + '...';

        } catch (error) {
            if (attempt < retries - 1) {
                const waitTime = Math.pow(2, attempt) * 3000;
                console.log(`⚠️  请求失败: ${error.message}，${waitTime/1000}秒后重试...`);
                await delay(waitTime);
                continue;
            }
            console.error(`生成摘要失败: ${error.message}`);
            return text.substring(0, 150) + '...';
        }
    }

    return text.substring(0, 150) + '...';
}

async function generateSummariesBatch(articles) {
    if (!QWEN_API_KEY) {
        console.log('⚠️  未配置通义千问API Key，使用原始描述\n');
        articles.forEach(article => {
            article.summary = article.description.substring(0, 150) + '...';
        });
        return;
    }

    console.log('\n🤖 开始生成AI中文摘要（通义千问）...\n');

    const BATCH_SIZE = 3;
    let processed = 0;

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
        const batch = articles.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (article) => {
            article.summary = await generateSummaryWithQwen(article.description);
            processed++;
            console.log(`[${processed}/${articles.length}] ${article.title.substring(0, 40)}...`);
        }));

        if (i + BATCH_SIZE < articles.length) {
            await delay(1000);
        }
    }

    console.log('✅ AI摘要生成完成\n');
}

// ==================== 主函数 ====================

async function main() {
    console.log('========================================');
    console.log('Li-Mat Frontier RSS抓取（通义千问版）');
    console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log('========================================\n');

    // 1. 并行抓取RSS
    const { allArticles, successCount, failCount } = await fetchAllRSS();
    console.log(`\n📊 成功 ${successCount} 个源，失败 ${failCount} 个源`);
    console.log(`📄 共获取 ${allArticles.length} 篇文章\n`);

    // 2. 去重
    const uniqueArticles = [];
    const titles = new Set();
    allArticles.forEach(article => {
        if (!titles.has(article.title)) {
            titles.add(article.title);
            uniqueArticles.push(article);
        }
    });
    console.log(`🔍 去重后 ${uniqueArticles.length} 篇文章\n`);

    // 3. 排序并保留最新50篇
    uniqueArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
    const limitedArticles = uniqueArticles.slice(0, 50);
    console.log(`📌 保留最新 ${limitedArticles.length} 篇文章\n`);

    // 4. 生成AI摘要
    await generateSummariesBatch(limitedArticles);

    // 5. 保存数据
    const outputData = {
        lastUpdated: new Date().toISOString(),
        updateTime: new Date().toLocaleString('zh-CN'),
        totalArticles: limitedArticles.length,
        categories: Object.keys(RSS_SOURCES),
        articles: limitedArticles
    };

    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const outputPath = path.join(dataDir, 'news.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

    console.log('========================================');
    console.log(`✅ 数据已保存: ${outputPath}`);
    console.log(`✅ 共 ${limitedArticles.length} 篇文章`);
    console.log('========================================');
}

main().catch(error => {
    console.error('❌ 错误:', error);
    process.exit(1);
}).then(() => {
    // 确保进程正常退出
    process.exit(0);
});
