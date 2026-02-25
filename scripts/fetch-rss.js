 // RSS 抓取和处理脚本
  // 用于 Li-Mat Frontier 汽车材料资讯聚合

  const Parser = require('rss-parser');
  const fs = require('fs');
  const path = require('path');

  // ==================== 配置区域 ====================

  // RSS 源配置 - 使用可靠的通用RSS源
  const RSS_SOURCES = {
      '综合新闻': [
          'https://hnrss.org/frontpage',
          'https://rss.cnn.com/rss/cnn_topstories.rss',
          'https://feeds.bbci.co.uk/news/rss.xml'
      ],
      '科技资讯': [
          'https://techcrunch.com/feed/',
          'https://www.theverge.com/rss/index.xml'
      ],
      '汽车新闻': [
          'https://www.autoblog.com/rss.xml',
          'https://www.motor1.com/rss/news/'
      ]
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

  // ==================== RSS 抓取 ====================

  async function fetchRSS(url, category) {
      const parser = new Parser({
          timeout: 15000,
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
                  summary: description.substring(0, 150) + '...' // 直接使用描述前150字
              });
          }

          console.log(`✓ ${url} - 成功获取 ${articles.length} 条`);
          return articles;

      } catch (error) {
          console.error(`✗ ${url} - 失败: ${error.message}`);
          return [];
      }
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
              await sleep(1000);
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

      // 只保留最新的50篇
      const limitedArticles = uniqueArticles.slice(0, 50);
      console.log(`📌 保留最新 ${limitedArticles.length} 篇文章\n`);

      // 生成数据文件
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
