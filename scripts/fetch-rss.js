// Li-Mat Frontier RSS 抓取脚本
// 使用阿里通义千问API生成中文摘要

const Parser = require('rss-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================

// 阿里通义千问API配置
const QWEN_API_KEY = process.env.QWEN_API_KEY;

// RSS源配置 - 汽车行业专业源
const RSS_SOURCES = [
    'https://www.automotiveworld.com/feed/',
    'https://www.carbon-fiber.eu/feed/',
    'https://www.european-coatings.com/rss',
    'https://www.sustainablebrands.com/rss',
    'https://www.technologyreview.com/feed/',
    'https://www.sae.org/news/rss',
    'https://www.compositesworld.com/rss',
    'https://www.plasticstoday.com/rss.xml'
];

// 关键词过滤配置 - 根据您的需求精确匹配
const CATEGORY_KEYWORDS = {
    '材料创新': {
        include: [
            // 金属材料
            'aluminum', 'aluminium', 'steel', 'alloy', 'metal', 'titanium', 'magnesium', 'lightweight metal', 'automotive metal',
            // 非金属材料
            'carbon fiber', 'carbon fibre', 'composite', 'plastic', 'polymer', 'automotive plastic', 'thermoplastic', 'resin', 'fiber glass', 'fiberglass'
        ],
        exclude: ['semiconductor', 'chip', 'processor', 'cpu', 'gpu']
    },
    '汽车防腐': {
        include: ['corrosion', 'anti-corrosion', 'coating', 'paint', 'surface treatment', 'rust', 'galvaniz', 'cathodic protection', 'automotive coating'],
        exclude: []
    },
    '车内健康': {
        include: [
            'formaldehyde', 'voc', 'volatile organic', 'odor', 'odour', 'low-odor',
            'interior material', 'cabin air', 'air quality', 'low-emission',
            'indoor air', 'emission', 'toxic', 'health', 'safety', 'cleanroom',
            'antimicrobial', 'antibacterial', 'hypoallergenic', 'eco-friendly',
            'non-toxic', 'green material', 'sustainable interior', 'bio-based',
            'natural fiber', 'recycled fabric', 'breathable', 'ventilation'
        ],
        exclude: []
    }
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

// 计算文章相关性得分 (0-100)
function calculateRelevanceScore(article, category) {
    const keywords = CATEGORY_KEYWORDS[category];
    if (!keywords) return 0;

    const searchText = `${article.title} ${article.description}`.toLowerCase();
    let score = 0;

    // 检查排除关键词
    for (const excludeWord of keywords.exclude) {
        if (searchText.includes(excludeWord.toLowerCase())) {
            return 0; // 如果包含排除关键词,得分为0
        }
    }

    // 计算匹配的关键词数量
    let matchCount = 0;
    for (const includeWord of keywords.include) {
        if (searchText.includes(includeWord.toLowerCase())) {
            matchCount++;

            // 标题中出现关键词,额外加分
            if (article.title.toLowerCase().includes(includeWord.toLowerCase())) {
                matchCount += 2;
            }
        }
    }

    // 转换为0-100的得分
    score = Math.min(100, matchCount * 10);
    return score;
}

// 关键词匹配函数 - 检查文章是否匹配某个分类
function matchesCategory(article, category) {
    return calculateRelevanceScore(article, category) > 0;
}

// 为文章匹配最佳分类,返回分类和相关性得分
function assignCategory(article) {
    const categories = Object.keys(CATEGORY_KEYWORDS);
    let bestCategory = null;
    let bestScore = 0;

    for (const category of categories) {
        const score = calculateRelevanceScore(article, category);
        if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
        }
    }

    return { category: bestCategory, relevanceScore: bestScore };
}

// 计算综合得分: 相关性(50%) + 时效性(50%)
function calculateFinalScore(article, maxDate, minDate) {
    // 时效性得分 (0-100)
    const articleTime = new Date(article.date).getTime();
    const timeRange = maxDate - minDate;
    const timeScore = timeRange > 0 ? ((articleTime - minDate) / timeRange) * 100 : 50;

    // 综合得分 = 相关性得分 * 0.5 + 时效性得分 * 0.5
    const finalScore = (article.relevanceScore || 0) * 0.5 + timeScore * 0.5;

    return finalScore;
}

// ==================== RSS抓取（并行） ====================

async function fetchRSS(url) {
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
            category: '',  // 稍后根据关键词匹配
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

    const promises = RSS_SOURCES.map(url => fetchRSS(url));
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
                                content: '你是专业的汽车材料技术翻译专家。将英文内容翻译成中文并生成详细的摘要（200-300字）。摘要要包含：1)核心内容概述 2)技术要点 3)应用价值。直接输出摘要，不要添加前缀。'
                            },
                            {
                                role: 'user',
                                content: `请翻译并生成摘要（200-300字）：\n\n${text.substring(0, 800)}`
                            }
                        ]
                    },
                    parameters: {
                        max_tokens: 500,
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

    // 3. 根据关键词匹配分类并过滤
    console.log('🎯 开始关键词匹配分类...\n');
    const categorizedArticles = [];
    const categoryStats = {};

    uniqueArticles.forEach(article => {
        const result = assignCategory(article);
        if (result.category) {
            article.category = result.category;
            article.relevanceScore = result.relevanceScore;
            categorizedArticles.push(article);
            categoryStats[result.category] = (categoryStats[result.category] || 0) + 1;
        }
    });

    console.log('📊 分类统计:');
    Object.entries(categoryStats).forEach(([category, count]) => {
        console.log(`   ${category}: ${count} 篇`);
    });
    console.log(`   总计: ${categorizedArticles.length} 篇（过滤掉 ${uniqueArticles.length - categorizedArticles.length} 篇不相关文章）\n`);

    // 4. 计算综合得分并排序
    console.log('🔢 计算综合得分(相关性50% + 时效性50%)...\n');

    // 找出最新和最旧的文章时间
    const dates = categorizedArticles.map(a => new Date(a.date).getTime());
    const maxDate = Math.max(...dates);
    const minDate = Math.min(...dates);

    // 为每篇文章计算综合得分
    categorizedArticles.forEach(article => {
        article.finalScore = calculateFinalScore(article, maxDate, minDate);
    });

    // 按综合得分排序
    categorizedArticles.sort((a, b) => b.finalScore - a.finalScore);

    // 5. 应用分类配额机制 - 确保每个分类至少3篇
    console.log('📋 应用分类配额机制(每类至少3篇)...\n');

    const MIN_PER_CATEGORY = 3;
    const TOTAL_LIMIT = 50;
    const categories = Object.keys(CATEGORY_KEYWORDS);

    const limitedArticles = [];
    const usedArticles = new Set();

    // 第一轮: 为每个分类保证最低配额
    categories.forEach(category => {
        const categoryArticles = categorizedArticles
            .filter(a => a.category === category && !usedArticles.has(a.link))
            .sort((a, b) => b.relevanceScore - a.relevanceScore); // 按相关性排序

        const quota = Math.min(MIN_PER_CATEGORY, categoryArticles.length);

        for (let i = 0; i < quota; i++) {
            limitedArticles.push(categoryArticles[i]);
            usedArticles.add(categoryArticles[i].link);
        }

        console.log(`   ${category}: 保证 ${quota} 篇 (相关性优先)`);
    });

    // 第二轮: 用综合得分最高的文章填满剩余名额
    const remaining = TOTAL_LIMIT - limitedArticles.length;
    const remainingArticles = categorizedArticles
        .filter(a => !usedArticles.has(a.link))
        .slice(0, remaining);

    limitedArticles.push(...remainingArticles);

    console.log(`   填充剩余: ${remaining} 篇 (综合得分优先)`);
    console.log(`\n📌 最终保留 ${limitedArticles.length} 篇文章\n`);

    // 显示最终分类统计
    const finalStats = {};
    limitedArticles.forEach(article => {
        finalStats[article.category] = (finalStats[article.category] || 0) + 1;
    });
    console.log('📊 最终分类统计:');
    Object.entries(finalStats).forEach(([category, count]) => {
        console.log(`   ${category}: ${count} 篇`);
    });
    console.log('');

    // 6. 生成AI摘要
    await generateSummariesBatch(limitedArticles);

    // 7. 保存数据
    const outputData = {
        lastUpdated: new Date().toISOString(),
        updateTime: new Date().toLocaleString('zh-CN'),
        totalArticles: limitedArticles.length,
        categories: Object.keys(CATEGORY_KEYWORDS),
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
