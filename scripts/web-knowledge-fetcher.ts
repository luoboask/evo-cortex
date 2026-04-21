#!/usr/bin/env ts-node
/**
 * 网络知识自动获取器
 * 
 * 从配置的 URL 列表抓取网页内容，提取知识并更新知识图谱
 */

import * as fs from 'fs';
import * as path from 'path';
import { WebCrawler, CrawledPage } from '../src/knowledge/web_crawler.js';

interface KnowledgeSource {
  id: string;
  name: string;
  url: string;
  type: string;
  tags: string[];
  priority: number;
  enabled: boolean;
}

interface SourcesConfig {
  sources: KnowledgeSource[];
  crawlConfig: {
    timeout: number;
    maxRetries: number;
    concurrency: number;
    cacheEnabled: boolean;
    cacheDir: string;
  };
}

interface ExtractedKnowledge {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  content: string;
  keywords: string[];
  entities: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  crawledAt: string;
}

class WebKnowledgeFetcher {
  private crawler: WebCrawler;
  private config: SourcesConfig;
  private workspaceDir: string;
  private outputDir: string;

  constructor(agentId: string) {
    // 加载配置
    const configPath = path.join(__dirname, '../knowledge/sources.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // 初始化爬虫
    this.crawler = new WebCrawler({
      timeout: this.config.crawlConfig.timeout,
      maxRetries: this.config.crawlConfig.maxRetries,
      cacheDir: this.config.crawlConfig.cacheDir
    });

    // 设置输出目录
    this.workspaceDir = process.env.OPENCLAW_WORKSPACE || `~/.openclaw/workspace-${agentId}`;
    this.outputDir = path.join(this.workspaceDir, 'knowledge', 'web-sources');
    
    // 确保输出目录存在
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 执行知识获取
   */
  async fetch(): Promise<void> {
    console.log('🌐 开始获取网络知识...');
    console.log(`工作区：${this.workspaceDir}`);
    console.log(`输出目录：${this.outputDir}`);
    
    const enabledSources = this.config.sources.filter(s => s.enabled);
    console.log(`启用 ${enabledSources.length}/${this.config.sources.length} 个知识源\n`);

    const results: ExtractedKnowledge[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const source of enabledSources) {
      try {
        console.log(`📡 抓取：${source.name} (${source.url})`);
        
        const page = await this.crawler.crawl(source.url);
        
        // 提取知识
        const knowledge = this.extractKnowledge(source, page);
        results.push(knowledge);
        
        // 保存结果
        this.saveKnowledge(knowledge);
        
        // 更新记忆文件
        this.appendMemory(source, page);
        
        successCount++;
        console.log(`  ✅ 成功 - 标题：${page.title}`);
        console.log(`     关键词：${page.keywords.slice(0, 5).join(', ')}...`);
        console.log(`     内容长度：${page.content.length} 字符\n`);
        
      } catch (error) {
        failCount++;
        console.error(`  ❌ 失败：${source.name}`);
        console.error(`     错误：${error.message}\n`);
      }
      
      // 避免请求过快
      await this.sleep(1000);
    }

    // 生成报告
    this.generateReport(results, successCount, failCount);
    
    console.log('\n✨ 网络知识获取完成!');
    console.log(`成功：${successCount}, 失败：${failCount}`);
    console.log(`输出目录：${this.outputDir}`);
  }

  /**
   * 从抓取的页面中提取知识
   */
  private extractKnowledge(source: KnowledgeSource, page: CrawledPage): ExtractedKnowledge {
    // 简单实体提取（基于关键词和标题）
    const entities = this.extractEntities(page);
    
    return {
      sourceId: source.id,
      sourceName: source.name,
      url: page.url,
      title: page.title,
      content: page.content.substring(0, 5000), // 限制长度
      keywords: page.keywords,
      entities: entities,
      crawledAt: new Date().toISOString()
    };
  }

  /**
   * 提取实体（简化版）
   */
  private extractEntities(page: CrawledPage): Array<{name: string; type: string; description: string}> {
    const entities: Array<any> = [];
    
    // 从标题提取
    if (page.title) {
      entities.push({
        name: page.title,
        type: 'documentation/title',
        description: `来自 ${page.url} 的文档标题`
      });
    }
    
    // 从关键词提取（前 10 个）
    page.keywords.slice(0, 10).forEach(keyword => {
      if (keyword.length > 3 && keyword.length < 50) {
        entities.push({
          name: keyword,
          type: 'concept/keyword',
          description: `从 ${page.url} 提取的关键词`
        });
      }
    });
    
    return entities;
  }

  /**
   * 保存知识到文件
   */
  private saveKnowledge(knowledge: ExtractedKnowledge): void {
    const filename = `${knowledge.sourceId}-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(this.outputDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(knowledge, null, 2));
    console.log(`  📄 已保存：${filename}`);
  }

  /**
   * 追加到记忆文件
   */
  private appendMemory(source: KnowledgeSource, page: CrawledPage): void {
    const memoryFile = path.join(this.workspaceDir, 'memory', `${new Date().toISOString().split('T')[0]}.md`);
    
    const memoryEntry = `
## 【🌐 网络知识】${source.name}

**时间**: ${new Date().toISOString()}  
**来源**: ${source.name}  
**URL**: ${page.url}  
**标题**: ${page.title}

### 关键词
${page.keywords.slice(0, 10).map(k => `- ${k}`).join('\n')}

### 内容摘要
${page.content.substring(0, 1000)}...

---
`;
    
    if (fs.existsSync(memoryFile)) {
      fs.appendFileSync(memoryFile, memoryEntry);
    } else {
      fs.writeFileSync(memoryFile, `# ${new Date().toISOString().split('T')[0]} - Daily Memory\n\n${memoryEntry}`);
    }
    
    console.log(`  📝 已追加到记忆文件`);
  }

  /**
   * 生成报告
   */
  private generateReport(results: ExtractedKnowledge[], success: number, fail: number): void {
    const reportFile = path.join(this.outputDir, `fetch-report-${new Date().toISOString().split('T')[0]}.md`);
    
    const report = `# 网络知识获取报告

**执行时间**: ${new Date().toISOString()}  
**成功**: ${success}  
**失败**: ${fail}  

## 获取的知识

${results.map(r => `
### ${r.sourceName}
- **URL**: ${r.url}
- **标题**: ${r.title}
- **关键词**: ${r.keywords.slice(0, 5).join(', ')}
- **实体数**: ${r.entities.length}
`).join('\n')}

## 新增实体

${results.flatMap(r => r.entities).map(e => `- **${e.name}** (${e.type}): ${e.description}`).join('\n')}
`;
    
    fs.writeFileSync(reportFile, report);
    console.log(`  📊 已生成报告：${path.basename(reportFile)}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 主函数
async function main() {
  const agentId = process.argv[2];
  
  if (!agentId) {
    console.error('用法：ts-node web-knowledge-fetcher.ts <agent-id>');
    process.exit(1);
  }
  
  const fetcher = new WebKnowledgeFetcher(agentId);
  await fetcher.fetch();
}

main().catch(console.error);
