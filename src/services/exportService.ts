import { Book, StoryNode } from '../types';
import { db, getBookNodes } from '../db';

/**
 * 导出服务 - 支持多种格式导出
 */

// 获取节点类型名称
const getNodeTypeName = (type: string) => {
  switch (type) {
    case 'volume': return '卷';
    case 'arc': return '大剧情';
    case 'chapter': return '章';
    case 'scene': return '场景';
    default: return type;
  }
};

const buildSceneMetaLines = (node: StoryNode) => {
  if (node.type !== 'scene' || !node.meta) return [] as string[];
  const lines: string[] = [];
  if (node.meta.pov) lines.push(`POV: ${node.meta.pov}`);
  if (node.meta.timeTag) lines.push(`时间: ${node.meta.timeTag}`);
  if (node.meta.location) lines.push(`地点: ${node.meta.location}`);
  if (node.meta.conflictType) lines.push(`冲突: ${node.meta.conflictType}`);
  if (node.meta.participants && node.meta.participants.length > 0) lines.push(`角色: ${node.meta.participants.join('、')}`);
  if (node.meta.tags && node.meta.tags.length > 0) lines.push(`标签: ${node.meta.tags.join('、')}`);
  return lines;
};

/**
 * 导出为 Markdown 格式
 */
export const exportAsMarkdown = async (book: Book): Promise<string> => {
  const nodes = await getBookNodes(book.id);
  const facts = await db.facts.where('bookId').equals(book.id).toArray();

  let markdown = `# ${book.title}\n\n`;
  markdown += `> ${book.premise}\n\n`;
  markdown += `---\n\n`;

  // 世界观
  markdown += `## 世界设定\n\n${book.worldSetting}\n\n`;

  // 角色
  markdown += `## 角色表\n\n`;
  book.characters.forEach(char => {
    markdown += `### ${char.name}\n`;
    markdown += `- **身份**: ${char.role}\n`;
    markdown += `- **介绍**: ${char.description}\n`;
    markdown += `- **秘密**: ${char.secret}\n\n`;
  });

  if (facts.length > 0) {
    markdown += `## 事实库\n\n`;
    facts
      .filter((fact) => fact.status === 'active')
      .sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt)
      .forEach((fact) => {
        markdown += `- ${fact.locked ? '[锁定] ' : ''}${fact.statement}\n`;
      });
    markdown += `\n`;
  }

  markdown += `---\n\n`;
  markdown += `## 正文\n\n`;

  // 递归构建内容
  const buildContent = (parentId: string | null, level: number): void => {
    const children = nodes
      .filter(n => n.parentId === parentId)
      .sort((a, b) => a.order - b.order);

    children.forEach(node => {
      const headingLevel = Math.min(level + 2, 6); // Markdown最多6级标题
      const heading = '#'.repeat(headingLevel);

      markdown += `${heading} ${getNodeTypeName(node.type)}：${node.title}\n\n`;

      if (node.summary) {
        markdown += `> ${node.summary}\n\n`;
      }

      const metaLines = buildSceneMetaLines(node);
      if (metaLines.length > 0) {
        markdown += `> ${metaLines.join(' | ')}\n\n`;
      }

      if (node.content && node.content.trim()) {
        markdown += `${node.content}\n\n`;
      }

      // 递归处理子节点
      buildContent(node.id, level + 1);
    });
  };

  buildContent(null, 0);

  markdown += `\n---\n\n`;
  markdown += `*由织梦机-AI生成 | 总字数：${book.wordCount || '统计中'}*\n`;

  return markdown;
};

/**
 * 导出为纯文本格式
 */
export const exportAsText = async (book: Book): Promise<string> => {
  const nodes = await getBookNodes(book.id);
  const facts = await db.facts.where('bookId').equals(book.id).toArray();

  let text = `${book.title}\n`;
  text += `${'='.repeat(book.title.length)}\n\n`;
  text += `${book.premise}\n\n`;
  text += `${'='.repeat(40)}\n\n`;

  // 世界观
  text += `【世界设定】\n${book.worldSetting}\n\n`;

  // 角色
  text += `【角色表】\n`;
  book.characters.forEach((char, idx) => {
    text += `${idx + 1}. ${char.name}（${char.role}）\n`;
    text += `   ${char.description}\n`;
    text += `   秘密：${char.secret}\n\n`;
  });

  if (facts.length > 0) {
    text += `【事实库】\n`;
    facts
      .filter((fact) => fact.status === 'active')
      .sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt)
      .forEach((fact, idx) => {
        text += `${idx + 1}. ${fact.locked ? '[锁定] ' : ''}${fact.statement}\n`;
      });
    text += `\n`;
  }

  text += `${'='.repeat(40)}\n\n`;
  text += `【正文】\n\n`;

  // 递归构建内容
  const buildContent = (parentId: string | null, indent: string): void => {
    const children = nodes
      .filter(n => n.parentId === parentId)
      .sort((a, b) => a.order - b.order);

    children.forEach(node => {
      text += `${indent}${getNodeTypeName(node.type)}：${node.title}\n`;

      if (node.summary) {
        text += `${indent}  ${node.summary}\n`;
      }

      const metaLines = buildSceneMetaLines(node);
      if (metaLines.length > 0) {
        text += `${indent}  [元数据] ${metaLines.join(' | ')}\n`;
      }

      if (node.content && node.content.trim()) {
        text += `\n${node.content}\n\n`;
      }

      // 递归处理子节点
      buildContent(node.id, indent + '  ');
    });
  };

  buildContent(null, '');

  text += `\n${'='.repeat(40)}\n`;
  text += `总字数：${book.wordCount || '统计中'}\n`;
  text += `由织梦机-AI生成\n`;

  return text;
};

/**
 * 导出部分内容（指定节点及其子树）
 */
export const exportPartial = async (
  book: Book,
  rootNodeId: string,
  format: 'markdown' | 'text'
): Promise<string> => {
  const allNodes = await getBookNodes(book.id);
  const rootNode = allNodes.find(n => n.id === rootNodeId);

  if (!rootNode) {
    throw new Error('节点不存在');
  }

  // 获取子树所有节点
  const getSubtree = (nodeId: string): StoryNode[] => {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node) return [];

    const children = allNodes.filter(n => n.parentId === nodeId);
    return [node, ...children.flatMap(child => getSubtree(child.id))];
  };

  const subtreeNodes = getSubtree(rootNodeId);

  if (format === 'markdown') {
    let markdown = `# ${rootNode.title}\n\n`;
    markdown += `> ${rootNode.summary}\n\n`;
    markdown += `---\n\n`;

    const buildContent = (parentId: string, level: number): void => {
      const children = subtreeNodes
        .filter(n => n.parentId === parentId)
        .sort((a, b) => a.order - b.order);

      children.forEach(node => {
        const headingLevel = Math.min(level + 1, 6);
        const heading = '#'.repeat(headingLevel);

        markdown += `${heading} ${node.title}\n\n`;

        if (node.content) {
          markdown += `${node.content}\n\n`;
        }

        buildContent(node.id, level + 1);
      });
    };

    if (rootNode.content) {
      markdown += `${rootNode.content}\n\n`;
    }

    buildContent(rootNodeId, 1);

    return markdown;
  } else {
    let text = `${rootNode.title}\n${'='.repeat(rootNode.title.length)}\n\n`;
    text += `${rootNode.summary}\n\n`;

    const buildContent = (parentId: string, indent: string): void => {
      const children = subtreeNodes
        .filter(n => n.parentId === parentId)
        .sort((a, b) => a.order - b.order);

      children.forEach(node => {
        text += `${indent}${node.title}\n`;

        if (node.content) {
          text += `\n${node.content}\n\n`;
        }

        buildContent(node.id, indent + '  ');
      });
    };

    if (rootNode.content) {
      text += `${rootNode.content}\n\n`;
    }

    buildContent(rootNodeId, '');

    return text;
  }
};

/**
 * 触发浏览器下载
 */
export const downloadFile = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * 导出为 HTML 格式 (可被 Word 打开)
 */
export const exportAsHTML = async (book: Book): Promise<string> => {
  const nodes = await getBookNodes(book.id);
  const facts = await db.facts.where('bookId').equals(book.id).toArray();

  let html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <title>${book.title}</title>
      <style>
        body { font-family: 'Songti SC', 'SimSun', serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { text-align: center; color: #333; }
        h2 { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 40px; }
        h3 { color: #555; }
        p { margin-bottom: 1em; text-indent: 2em; }
        .meta { text-align: center; color: #666; font-size: 0.9em; margin-bottom: 40px; }
        .toc { background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 40px; }
        .toc ul { list-style: none; padding-left: 0; }
        .toc li { margin-bottom: 5px; }
        .toc a { text-decoration: none; color: #0066cc; }
        .toc a:hover { text-decoration: underline; }
        .chapter-title { font-size: 1.5em; font-weight: bold; margin-top: 30px; page-break-before: always; }
        .scene-title { font-size: 1.2em; font-weight: bold; margin-top: 20px; color: #666; }
        .divider { text-align: center; margin: 30px 0; color: #ccc; }
      </style>
    </head>
    <body>
      <h1>${book.title}</h1>
      <div class="meta">
        <p>核心梗概：${book.premise}</p>
        <p>总字数：${book.wordCount || '统计中'}</p>
      </div>

      ${facts.length > 0 ? `
      <h2>事实库</h2>
      <ul>
        ${facts
          .filter((fact) => fact.status === 'active')
          .sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt)
          .map((fact) => `<li>${fact.locked ? '[锁定] ' : ''}${fact.statement}</li>`)
          .join('')}
      </ul>
      ` : ''}

      <div class="toc">
        <h2>目录</h2>
        <ul>
  `;

  // 构建目录 (只包含卷和章)
  const tocNodes = nodes.filter(n => n.type === 'volume' || n.type === 'chapter').sort((a, b) => a.order - b.order);
  // 这里简化处理，实际目录应该递归。为演示简单起见，我们只列出第一层和第二层
  // 更好的方式是遍历
  const buildTOC = (parentId: string | null, level: number): string => {
     const children = nodes.filter(n => n.parentId === parentId).sort((a, b) => a.order - b.order);
     let tocHtml = '';
     children.forEach(node => {
        if (node.type === 'scene') return; // 目录不显示场景
        const indent = level * 20;
        tocHtml += `<li style="padding-left: ${indent}px"><a href="#node-${node.id}">${getNodeTypeName(node.type)}：${node.title}</a></li>`;
        tocHtml += buildTOC(node.id, level + 1);
     });
     return tocHtml;
  };

  html += buildTOC(null, 0);

  html += `
        </ul>
      </div>

      <h2>世界设定</h2>
      <div style="white-space: pre-wrap;">${book.worldSetting}</div>

      <h2>角色档案</h2>
      ${book.characters.map(char => `
        <div class="character">
          <h3>${char.name} <small>(${char.role})</small></h3>
          <p><strong>简介：</strong>${char.description}</p>
          <p><strong>秘密：</strong>${char.secret}</p>
        </div>
      `).join('')}

      <h2>正文</h2>
  `;

  // 递归构建正文
  const buildContent = (parentId: string | null, level: number): void => {
    const children = nodes
      .filter(n => n.parentId === parentId)
      .sort((a, b) => a.order - b.order);

    children.forEach(node => {
      html += `<div id="node-${node.id}">`;

      if (node.type === 'volume' || node.type === 'arc' || node.type === 'chapter') {
          html += `<div class="chapter-title">${getNodeTypeName(node.type)}：${node.title}</div>`;
          if (node.summary) html += `<p><em>（${node.summary}）</em></p>`;
      } else {
          html += `<div class="scene-title">${node.title}</div>`;
          const metaLines = buildSceneMetaLines(node);
          if (metaLines.length > 0) {
            html += `<p><em>${metaLines.join(' | ')}</em></p>`;
          }
      }

      if (node.content) {
        // 简单的 Markdown 转 HTML 处理 (换行转段落)
        const paras = node.content.split('\n').filter(p => p.trim());
        html += paras.map(p => `<p>${p}</p>`).join('');
      }

      html += `</div>`;

      buildContent(node.id, level + 1);
    });
  };

  buildContent(null, 0);

  html += `
      <div class="divider">--- 全文完 ---</div>
      <div style="text-align: center; font-size: 0.8em; color: #999; margin-top: 50px;">
        Generated by NovelWeaver-AI
      </div>
    </body>
    </html>
  `;

  return html;
};
