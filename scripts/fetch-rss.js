// RSS 抓取和处理脚本
// 用于 Li-Mat Frontier 汽车材料资讯聚合

const Parser = require('rss-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ==================== 配置区域 ====================

// 豆包 API Key（从环境变量读取）
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY;
const DOUBAO_MODEL = 'doubao-lite-4k';

// RSS 源配置
const RSS_SOURCES = {
    '综合资讯': [
        'https://hnrss.org/frontpage',
        'https://feeds.feedburner.com/zhihu-daily',
        'https://www.cnautonews.net/feed/'
    ],
    '金属材料': [
        'https://www.worldmetals.com.cn/feed/',
        'https://www.albiz.cn/feed/',
        'https://www.mw35.com/feed/'
    ],
    '非金属材料': [
        'https://www.frp.cn/feed/',
        'https://www.21cp.com/feed/',
        'https://www.tanxianwei.cn/feed/'
    ],
    '汽车防腐': [
        'https://www.csea.com.cn/feed/',
        'https://www.ffw.com.cn/feed/',
        'https://www.coatingol.com/feed/'
    ],
    '车内健康': [
        'https://www.chenei.org/feed/',
        'https://www.chevoc.com/feed/',
        'https://www.qcnsw.com/feed/'
    ],
    '紧固件': [
        'https://www.chinafastener.biz/feed/',
        'https://www.fastener-world.com.cn/feed/',
        'https://www.luosi.com/feed/'
    ],
    '环保合规': [
        'https://www.caam.org.cn/feed/',
        'https://www.autoep.net/feed/',
        'https://www.catarc.ac.cn/feed/'
    ]
};

// 分类关键词
const CATEGORY_KEYWORDS = {
    '综合资讯': ['汽车', '新能源', '智能', '行业', '市场', '技术', '材料'],
    '金属材料': ['高强钢', '铝合金', '镁合金', '铜合金', '非晶', '金属', '钢材', '铝材', '镁', '铜'],
    '非金属材料': ['碳纤维', '玻纤', '复合材料', 'PMMA', '工程塑料', '塑料', '纤维', '树脂'],
    '汽车防腐': ['涂层', '防腐', '涂料', '涂装', '阴极', '电泳', '镀锌', '防锈', '腐蚀'],
    '车内健康': ['VOC', '甲醛', '异味', '散发', '空气质量', '健康', '气味', '挥发'],
    '紧固件': ['螺栓', '螺钉', '紧固', '连接', '扭矩', '紧固件', '螺母'],
    '环保合规': ['ELV', 'RoHS', '排放', '碳', '环保', '标准', '法规', '合规', '低碳']
};

// ==================== 工具函数 ====================

// 延时函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 去除 HTML 标签
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
}

// 判断文章是否相关
function isRelevant(title, description, category) {
    const content = (title + ' ' + description).toLowerCase();
    const keywords = CATEGORY_KEYWORDS[category] || [];

    // 如果标题或描述包含任一关键词，则认为相关
    return keywords.some(keyword => content.includes(keyword.toLowerCase()));
}

// ==================== RSS 抓取 ====================

async function fetchRSS(url, category) {
    const parser = new Parser({
        timeout: 10000,
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

            // 过滤相关内容
            if (isRelevant(title, description, category)) {
                articles.push({
                    title: title.trim(),
                    link: link.trim(),
                    date: new Date(pubDate).toISOString(),
                    category: category,
                    description: description.substring(0, 500),
                    summary: '' // 稍后生成
                });
            }
        }

        console.log(`✓ ${url} - 成功获取 ${articles.length} 条`);
        return articles;

    } catch (error) {
        console.error(`✗ ${url} - 失败: ${error.message}`);
        return [];
    }
}

// ==================== AI 摘要生成 ====================

async function generateSummary(title, description) {
    if (!DOUBAO_API_KEY) {
        console.warn('未配置豆包 API Key，跳过摘要生成');
        return description.substring(0, 100) + '...';
    }

    const prompt = `请用一句话（100字以内）概括以下汽车材料技术文章的核心内容，只提炼关键技术信息：

标题：${title}
内容：${description.substring(0, 500)}`;

    try {
        const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DOUBAO_API_KEY}`
            },
            body: JSON.stringify({
                model: DOUBAO_MODEL,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 150,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(`API 错误: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();

    } catch (error) {
        console.error(`生成摘要失败: ${error.message}`);
        return description.substring(0, 100) + '...';
    }
}

// 批量生成摘要
async function generateSummaries(articles) {
    console.log('\n开始生成 AI 摘要...');

    const batchSize = 5;
    let processed = 0;

    for (let i = 0; i < articles.length; i += batchSize) {
        const batch = articles.slice(i, i + batchSize);

        await Promise.all(batch.map(async (article) => {
            article.summary = await generateSummary(article.title, article.description);
            processed++;
            console.log(`[${processed}/${articles.length}] ${article.title.substring(0, 30)}...`);
        }));

        // 批次间隔 1 秒
        if (i + batchSize < articles.length) {
            await sleep(1000);
        }
    }

    console.log('✓ AI 摘要生成完成\n');
}

// ==================== 主函数 ====================

async function main() {
    console.log('========================================');
    console.log('Li-Mat Frontier RSS 抓取开始');
    console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log('========================================\n');

    const allArticles = [];
    let successCount = 0;
    let failCount = 0;

    // 遍历所有分类和 RSS 源
    for (const [category, urls] of Object.entries(RSS_SOURCES)) {
        console.log(`\n📥 分类: ${category}`);

        for (const url of urls) {
            const articles = await fetchRSS(url, category);

            if (articles.length > 0) {
                allArticles.push(...articles);
                successCount++;
            } else {
                failCount++;
            }

            // 请求间隔，避免被限流
            await sleep(500);
        }
    }

    console.log(`\n📊 抓取统计: 成功 ${successCount} 个源，失败 ${failCount} 个源`);
    console.log(`📄 共获取 ${allArticles.length} 篇文章\n`);

    // 去重
    const uniqueArticles = [];
    const titles = new Set();

    allArticles.forEach(article => {
        if (!titles.has(article.title)) {
            titles.add(article.title);
            uniqueArticles.push(article);
        }
    });

    console.log(`🔍 去重后剩余 ${uniqueArticles.length} 篇文章\n`);

    // 按时间倒序排序
    uniqueArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 生成 AI 摘要
    if (uniqueArticles.length > 0) {
        await generateSummaries(uniqueArticles);
    }

    // 生成数据文件
    const outputData = {
        lastUpdated: new Date().toISOString(),
        updateTime: new Date().toLocaleString('zh-CN'),
        totalArticles: uniqueArticles.length,
        categories: Object.keys(RSS_SOURCES),
        articles: uniqueArticles
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
    console.log('========================================');
}

// 执行主函数
main().catch(error => {
    console.error('❌ 发生错误:', error);
    process.exit(1);
});
