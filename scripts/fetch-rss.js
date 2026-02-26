// RSS 抓取和处理脚本（优化版）
// 用于 Li-Mat Frontier 汽车材料资讯聚合
// 优化点：1) 并行抓取 2) AI中文摘要 3) 更快的执行速度

const Parser = require('rss-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ==================== 配置区域 ====================

// AI API配置（推荐使用DeepSeek，更稳定）
const AI_PROVIDER = process.env.AI_PROVIDER || 'deepseek'; // 默认使用DeepSeek
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// RSS 源配置 - 使用参考网站验证过的可靠RSS源
const RSS_SOURCES = {
    '综合资讯': [
        'https://techcrunch.com/feed/',                               // TechCrunch
        'https://www.theverge.com/rss/index.xml',                     // The Verge
        'https://feeds.arstechnica.com/arstechnica/technology-lab',   // Ars Technica
        'https://www.wired.com/feed/rss',                             // Wired
        'https://venturebeat.com/feed/'                               // VentureBeat
    ],
    '金属材料': [
        'https://chipsandcheese.com/feed/',                           // Chips and Cheese
        'https://www.tomshardware.com/feeds/all',                     // Tom's Hardware
        'https://www.eetimes.com/feed/'                               // EE Times
    ],
    '非金属材料': [
        'https://www.technologyreview.com/feed/',                     // MIT Tech Review
        'https://www.carbon-fiber.eu/feed/',                          // 碳纤维欧洲
        'https://www.automotiveworld.com/feed/'                       // 汽车世界
    ],
    '汽车防腐': [
        'https://www.european-coatings.com/rss',                      // 欧洲涂料
        'https://www.automotiveworld.com/feed/'                       // 汽车世界
    ],
    '车内健康': [
        'https://www.sustainablebrands.com/rss',                      // 可持续品牌
        'https://www.automotiveworld.com/feed/'                       // 汽车世界
    ],
    '紧固件': [
        'https://www.automotiveworld.com/feed/'                       // 汽车世界
    ],
    '环保合规': [
        'https://www.sustainablebrands.com/rss',                      // 可持续品牌
        'https://www.automotiveworld.com/feed/'                       // 汽车世界
    ]
};

// ==================== 工具函数 ====================

// 延时函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 去除 HTML 标签
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
}

// 检测是否为中文
function isChinese(text) {
    if (!text) return false;
    return /[\u4e00-\u9fa5]/.test(text);
}

// ==================== RSS 抓取（并行优化）====================

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

        const articles = [];

        for (const item of feed.items) {
            const title = item.title || '';
            const link = item.link || '';
            const description = stripHtml(item.contentSnippet || item.content || item.description || '');
            const pubDate = item.pubDate || item.isoDate || new Date().toISOString();

            articles.push({
                title: title.trim(),
                link: link.trim(),
                date: new Date(pubDate).toISOString(),
                category: category,
                description: description.substring(0, 500),
                summary: '' // 稍后生成AI摘要
            });
        }

        console.log(`✓ ${url} - 成功获取 ${articles.length} 条`);
        return articles;

    } catch (error) {
        console.error(`✗ ${url} - 失败: ${error.message}`);
        return [];
    }
}

// 并行抓取所有RSS源（加速！）
async function fetchAllRSS() {
    console.log('🚀 使用并行抓取模式，速度更快...\n');

    const allPromises = [];

    for (const [category, urls] of Object.entries(RSS_SOURCES)) {
        console.log(`📥 分类: ${category}`);

        // 并行抓取该分类下的所有RSS源
        const categoryPromises = urls.map(url => fetchRSS(url, category));
        allPromises.push(...categoryPromises);

        // 分类之间稍微延迟一下
        await delay(500);
    }

    // 等待所有RSS源抓取完成
    const results = await Promise.allSettled(allPromises);

    // 收集成功的结果
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

// ==================== AI 摘要生成 ====================

// 使用豆包API生成中文摘要
async function generateSummaryWithDoubao(text, retries = 3) {
    const apiKey = DOUBAO_API_KEY;
    const endpoint = process.env.DOUBAO_ENDPOINT || 'ep-20250120161712-wjxld'; // 默认endpoint

    if (!apiKey) {
        console.warn('⚠️  未配置豆包API Key，跳过摘要生成');
        return text.substring(0, 150) + '...';
    }

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            // 豆包API需要使用特定的endpoint
            const response = await fetch(`https://ark.cn-beijing.volces.com/api/v3/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: endpoint, // 使用endpoint ID作为model
                    messages: [{
                        role: 'user',
                        content: `请将以下汽车材料技术文章翻译成中文并生成简短摘要（100字以内），只输出摘要内容：\n\n${text.substring(0, 500)}`
                    }],
                    max_tokens: 200,
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                const status = response.status;
                if ((status === 429 || status === 503) && attempt < retries - 1) {
                    const waitTime = Math.pow(2, attempt) * 3000;
                    console.log(`⚠️  豆包API限流 (${status})，${waitTime/1000}秒后重试...`);
                    await delay(waitTime);
                    continue;
                }
                throw new Error(`API错误: ${status}`);
            }

            const data = await response.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                const summary = data.choices[0].message.content.trim();
                return summary;
            }

            throw new Error('API返回格式错误');

        } catch (error) {
            if (attempt < retries - 1) {
                const waitTime = Math.pow(2, attempt) * 3000;
                console.log(`⚠️  请求失败: ${error.message}，${waitTime/1000}秒后重试...`);
                await delay(waitTime);
                continue;
            }
            console.error(`豆包API失败: ${error.message}`);
            return text.substring(0, 150) + '...';
        }
    }

    return text.substring(0, 150) + '...';
}

// 使用DeepSeek API生成中文摘要
async function generateSummaryWithDeepSeek(text, retries = 3) {
    const apiKey = DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.warn('⚠️  未配置DeepSeek API Key，跳过摘要生成');
        return text.substring(0, 150) + '...';
    }

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        {
                            role: 'system',
                            content: '你是专业的汽车材料技术翻译专家。将英文内容翻译成中文并生成简洁的摘要（100字以内）。直接输出摘要，不要添加前缀。'
                        },
                        {
                            role: 'user',
                            content: `请翻译并生成摘要：\n\n${text.substring(0, 500)}`
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 200
                })
            });

            if (!response.ok) {
                const status = response.status;
                if ((status === 429 || status === 503) && attempt < retries - 1) {
                    const waitTime = Math.pow(2, attempt) * 3000;
                    console.log(`⚠️  DeepSeek API限流 (${status})，${waitTime/1000}秒后重试...`);
                    await delay(waitTime);
                    continue;
                }
                throw new Error(`API错误: ${status}`);
            }

            const data = await response.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                const summary = data.choices[0].message.content.trim();
                return summary;
            }

            throw new Error('API返回格式错误');

        } catch (error) {
            if (attempt < retries - 1) {
                const waitTime = Math.pow(2, attempt) * 3000;
                console.log(`⚠️  请求失败: ${error.message}，${waitTime/1000}秒后重试...`);
                await delay(waitTime);
                continue;
            }
            console.error(`DeepSeek API失败: ${error.message}`);
            return text.substring(0, 150) + '...';
        }
    }

    return text.substring(0, 150) + '...';
}

// 统一的摘要生成接口
async function generateSummary(text) {
    // 如果已经是中文，直接返回
    if (isChinese(text)) {
        return text.substring(0, 150) + '...';
    }

    // 根据配置选择API
    if (AI_PROVIDER === 'deepseek') {
        return await generateSummaryWithDeepSeek(text);
    } else {
        return await generateSummaryWithDoubao(text);
    }
}

// 批量生成摘要（并行处理，但控制并发数）
async function generateSummariesBatch(articles) {
    console.log('\n🤖 开始生成AI中文摘要...');
    console.log(`📌 使用 ${AI_PROVIDER === 'deepseek' ? 'DeepSeek' : '豆包'} API\n`);

    const BATCH_SIZE = 3; // 每批3个并发请求
    let processed = 0;

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
        const batch = articles.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (article) => {
            const sourceText = article.description || article.content || '';
            article.summary = await generateSummary(sourceText);
            processed++;
            console.log(`[${processed}/${articles.length}] ${article.title.substring(0, 40)}...`);
        }));

        // 批次间短暂延迟
        if (i + BATCH_SIZE < articles.length) {
            await delay(1000);
        }
    }

    console.log('✅ AI摘要生成完成\n');
}

// ==================== 主函数 ====================

async function main() {
    console.log('========================================');
    console.log('Li-Mat Frontier RSS 抓取开始（优化版）');
    console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log('========================================\n');

    // 第一步：并行抓取所有RSS源
    const { allArticles, successCount, failCount } = await fetchAllRSS();

    console.log(`\n📊 抓取统计: 成功 ${successCount} 个源，失败 ${failCount} 个源`);
    console.log(`📄 共获取 ${allArticles.length} 篇文章\n`);

    // 第二步：去重
    const uniqueArticles = [];
    const titles = new Set();

    allArticles.forEach(article => {
        if (!titles.has(article.title)) {
            titles.add(article.title);
            uniqueArticles.push(article);
        }
    });

    console.log(`🔍 去重后剩余 ${uniqueArticles.length} 篇文章\n`);

    // 第三步：按时间倒序排序
    uniqueArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 第四步：只保留最新的50篇
    const limitedArticles = uniqueArticles.slice(0, 50);
    console.log(`📌 保留最新 ${limitedArticles.length} 篇文章\n`);

    // 第五步：生成AI中文摘要
    if (DOUBAO_API_KEY || DEEPSEEK_API_KEY) {
        await generateSummariesBatch(limitedArticles);
    } else {
        console.log('⚠️  未配置AI API Key，跳过摘要生成\n');
        // 使用原始描述作为摘要
        limitedArticles.forEach(article => {
            article.summary = article.description.substring(0, 150) + '...';
        });
    }

    // 第六步：生成数据文件
    const outputData = {
        lastUpdated: new Date().toISOString(),
        updateTime: new Date().toLocaleString('zh-CN'),
        totalArticles: limitedArticles.length,
        categories: Object.keys(RSS_SOURCES),
        articles: limitedArticles
    };

    // 确保 data 目录存在
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // 保存 JSON 文件
    const outputPath = path.join(dataDir, 'news.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

    console.log('========================================');
    console.log(`✅ 数据已保存到: ${outputPath}`);
    console.log(`✅ 共 ${limitedArticles.length} 篇文章`);
    console.log('========================================');
}

// 执行主函数
main().catch(error => {
    console.error('❌ 发生错误:', error);
    process.exit(1);
});
