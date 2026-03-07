import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { strToU8, zipSync } from 'fflate';
import { Book, FactEntry, MaterialEntry, SceneCharacterState, StoryNode } from '../types';
import { db, getBookNodes } from '../db';

interface ExportBundle {
  book: Book;
  nodes: StoryNode[];
  facts: FactEntry[];
  materials: MaterialEntry[];
  characterStates: SceneCharacterState[];
}

const getNodeTypeName = (type: string) => {
  switch (type) {
    case 'volume': return '卷';
    case 'arc': return '大剧情';
    case 'chapter': return '章';
    case 'scene': return '场景';
    default: return type;
  }
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeFilename = (value: string) => value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'book';

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

const loadBundle = async (book: Book): Promise<ExportBundle> => {
  const [nodes, facts, materials, characterStates] = await Promise.all([
    getBookNodes(book.id),
    db.facts.where('bookId').equals(book.id).toArray(),
    db.materials.where('bookId').equals(book.id).toArray(),
    db.characterStates.where('bookId').equals(book.id).toArray(),
  ]);

  return {
    book,
    nodes,
    facts,
    materials,
    characterStates,
  };
};

const getSortedChildren = (nodes: StoryNode[], parentId: string | null) => nodes
  .filter((node) => node.parentId === parentId)
  .sort((a, b) => a.order - b.order);

const buildCharacterStateMap = (states: SceneCharacterState[]) => states.reduce<Record<string, SceneCharacterState[]>>((acc, state) => {
  if (!acc[state.nodeId]) {
    acc[state.nodeId] = [];
  }
  acc[state.nodeId].push(state);
  return acc;
}, {});

const buildMarkdownFromBundle = (bundle: ExportBundle): string => {
  const { book, nodes, facts, materials, characterStates } = bundle;
  const characterStateMap = buildCharacterStateMap(characterStates);

  let markdown = `# ${book.title}\n\n`;
  markdown += `> ${book.premise}\n\n`;
  markdown += `---\n\n`;
  markdown += `## 世界设定\n\n${book.worldSetting}\n\n`;
  markdown += `## 角色表\n\n`;
  book.characters.forEach((char) => {
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
    markdown += '\n';
  }

  if (materials.length > 0) {
    markdown += `## 素材库\n\n`;
    materials
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((entry) => {
        const tags = (entry.tags || []).length > 0 ? `（${entry.tags.join('、')}）` : '';
        markdown += `- [${entry.type}] ${entry.title}${tags}\n`;
        markdown += `  - ${entry.content.slice(0, 140)}${entry.content.length > 140 ? '...' : ''}\n`;
      });
    markdown += '\n';
  }

  markdown += `---\n\n## 正文\n\n`;

  const buildContent = (parentId: string | null, level: number): void => {
    getSortedChildren(nodes, parentId).forEach((node) => {
      const headingLevel = Math.min(level + 2, 6);
      const heading = '#'.repeat(headingLevel);
      markdown += `${heading} ${getNodeTypeName(node.type)}：${node.title}\n\n`;

      if (node.summary) {
        markdown += `> ${node.summary}\n\n`;
      }

      const metaLines = buildSceneMetaLines(node);
      if (metaLines.length > 0) {
        markdown += `> ${metaLines.join(' | ')}\n\n`;
      }

      const nodeStates = characterStateMap[node.id] || [];
      if (nodeStates.length > 0) {
        markdown += `> 角色状态：${nodeStates.map((state) => `${state.characterName}（${[state.location, state.physicalState, state.knowledgeState, state.inventory].filter(Boolean).join(' / ') || '无补充'}）`).join('；')}\n\n`;
      }

      if (node.content && node.content.trim()) {
        markdown += `${node.content}\n\n`;
      }

      buildContent(node.id, level + 1);
    });
  };

  buildContent(null, 0);
  markdown += `\n---\n\n*由织梦机-AI生成 | 总字数：${book.wordCount || '统计中'}*\n`;
  return markdown;
};

const buildTextFromBundle = (bundle: ExportBundle): string => {
  const { book, nodes, facts, materials, characterStates } = bundle;
  const characterStateMap = buildCharacterStateMap(characterStates);

  let text = `${book.title}\n`;
  text += `${'='.repeat(book.title.length)}\n\n`;
  text += `${book.premise}\n\n`;
  text += `${'='.repeat(40)}\n\n`;
  text += `【世界设定】\n${book.worldSetting}\n\n`;
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
    text += '\n';
  }

  if (materials.length > 0) {
    text += `【素材库】\n`;
    materials
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((entry, idx) => {
        const tags = (entry.tags || []).length > 0 ? `（${entry.tags.join('、')}）` : '';
        text += `${idx + 1}. [${entry.type}] ${entry.title}${tags}\n`;
        text += `   ${entry.content.slice(0, 140)}${entry.content.length > 140 ? '...' : ''}\n`;
      });
    text += '\n';
  }

  text += `${'='.repeat(40)}\n\n【正文】\n\n`;

  const buildContent = (parentId: string | null, indent: string): void => {
    getSortedChildren(nodes, parentId).forEach((node) => {
      text += `${indent}${getNodeTypeName(node.type)}：${node.title}\n`;

      if (node.summary) {
        text += `${indent}  ${node.summary}\n`;
      }

      const metaLines = buildSceneMetaLines(node);
      if (metaLines.length > 0) {
        text += `${indent}  [元数据] ${metaLines.join(' | ')}\n`;
      }

      const nodeStates = characterStateMap[node.id] || [];
      if (nodeStates.length > 0) {
        text += `${indent}  [角色状态] ${nodeStates.map((state) => `${state.characterName}: ${[state.location, state.physicalState, state.knowledgeState, state.inventory].filter(Boolean).join(' / ') || '无补充'}`).join('；')}\n`;
      }

      if (node.content && node.content.trim()) {
        text += `\n${node.content}\n\n`;
      }

      buildContent(node.id, `${indent}  `);
    });
  };

  buildContent(null, '');
  text += `\n${'='.repeat(40)}\n`;
  text += `总字数：${book.wordCount || '统计中'}\n`;
  text += '由织梦机-AI生成\n';
  return text;
};

const buildHtmlFromBundle = (bundle: ExportBundle): string => {
  const { book, nodes, facts, materials, characterStates } = bundle;
  const characterStateMap = buildCharacterStateMap(characterStates);

  let html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(book.title)}</title>
      <style>
        body { font-family: 'Songti SC', 'SimSun', serif; line-height: 1.75; max-width: 860px; margin: 0 auto; padding: 24px; color: #222; }
        h1 { text-align: center; color: #111; }
        h2 { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 40px; }
        h3 { color: #444; }
        p { margin-bottom: 1em; text-indent: 2em; }
        .meta { text-align: center; color: #666; font-size: 0.92em; margin-bottom: 40px; }
        .toc, .panel { background: #f8f8f8; padding: 20px; border-radius: 12px; margin-bottom: 32px; }
        .toc ul, .plain-list { list-style: none; padding-left: 0; }
        .toc li { margin-bottom: 5px; }
        .toc a { text-decoration: none; color: #0066cc; }
        .chapter-title { font-size: 1.5em; font-weight: bold; margin-top: 30px; page-break-before: always; }
        .scene-title { font-size: 1.2em; font-weight: bold; margin-top: 20px; color: #666; }
        .divider { text-align: center; margin: 30px 0; color: #ccc; }
        .meta-line, .state-line { color: #666; font-style: italic; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(book.title)}</h1>
      <div class="meta">
        <p>核心梗概：${escapeHtml(book.premise)}</p>
        <p>总字数：${book.wordCount || '统计中'}</p>
      </div>

      <div class="toc">
        <h2>目录</h2>
        <ul>
  `;

  const buildTOC = (parentId: string | null, level: number): string => {
    let tocHtml = '';
    getSortedChildren(nodes, parentId).forEach((node) => {
      if (node.type === 'scene') return;
      tocHtml += `<li style="padding-left: ${level * 20}px"><a href="#node-${node.id}">${escapeHtml(`${getNodeTypeName(node.type)}：${node.title}`)}</a></li>`;
      tocHtml += buildTOC(node.id, level + 1);
    });
    return tocHtml;
  };

  html += buildTOC(null, 0);
  html += `
        </ul>
      </div>

      <div class="panel">
        <h2>世界设定</h2>
        <div style="white-space: pre-wrap;">${escapeHtml(book.worldSetting)}</div>
      </div>

      <div class="panel">
        <h2>角色档案</h2>
        ${book.characters.map((char) => `
          <div class="character">
            <h3>${escapeHtml(char.name)} <small>(${escapeHtml(char.role)})</small></h3>
            <p><strong>简介：</strong>${escapeHtml(char.description)}</p>
            <p><strong>秘密：</strong>${escapeHtml(char.secret)}</p>
          </div>
        `).join('')}
      </div>
  `;

  if (facts.length > 0) {
    html += `
      <div class="panel">
        <h2>事实库</h2>
        <ul class="plain-list">
          ${facts
            .filter((fact) => fact.status === 'active')
            .sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt)
            .map((fact) => `<li>${escapeHtml(`${fact.locked ? '[锁定] ' : ''}${fact.statement}`)}</li>`)
            .join('')}
        </ul>
      </div>
    `;
  }

  if (materials.length > 0) {
    html += `
      <div class="panel">
        <h2>素材库</h2>
        <ul class="plain-list">
          ${materials
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((entry) => `<li><strong>[${escapeHtml(entry.type)}]</strong> ${escapeHtml(entry.title)}<br />${escapeHtml(entry.content.slice(0, 180))}</li>`)
            .join('')}
        </ul>
      </div>
    `;
  }

  html += '<h2>正文</h2>';

  const buildContent = (parentId: string | null): void => {
    getSortedChildren(nodes, parentId).forEach((node) => {
      html += `<div id="node-${node.id}">`;
      if (node.type === 'volume' || node.type === 'arc' || node.type === 'chapter') {
        html += `<div class="chapter-title">${escapeHtml(`${getNodeTypeName(node.type)}：${node.title}`)}</div>`;
        if (node.summary) html += `<p><em>（${escapeHtml(node.summary)}）</em></p>`;
      } else {
        html += `<div class="scene-title">${escapeHtml(node.title)}</div>`;
      }

      const metaLines = buildSceneMetaLines(node);
      if (metaLines.length > 0) {
        html += `<p class="meta-line">${escapeHtml(metaLines.join(' | '))}</p>`;
      }

      const nodeStates = characterStateMap[node.id] || [];
      if (nodeStates.length > 0) {
        html += `<p class="state-line">${escapeHtml(nodeStates.map((state) => `${state.characterName}: ${[state.location, state.physicalState, state.knowledgeState, state.inventory].filter(Boolean).join(' / ') || '无补充'}`).join('；'))}</p>`;
      }

      if (node.content) {
        node.content.split('\n').filter((paragraph) => paragraph.trim()).forEach((paragraph) => {
          html += `<p>${escapeHtml(paragraph)}</p>`;
        });
      }

      html += '</div>';
      buildContent(node.id);
    });
  };

  buildContent(null);
  html += `
      <div class="divider">--- 全文完 ---</div>
      <div style="text-align: center; font-size: 0.8em; color: #999; margin-top: 50px;">Generated by Dreamweaver-AI</div>
    </body>
    </html>
  `;

  return html;
};

const buildDocxParagraphs = (bundle: ExportBundle): Paragraph[] => {
  const { book, nodes, facts, materials, characterStates } = bundle;
  const characterStateMap = buildCharacterStateMap(characterStates);
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: book.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: book.premise, italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    }),
    new Paragraph({ text: '目录', heading: HeadingLevel.HEADING_1 }),
  ];

  const appendToc = (parentId: string | null, depth: number) => {
    getSortedChildren(nodes, parentId).forEach((node) => {
      if (node.type === 'scene') return;
      paragraphs.push(new Paragraph({
        text: `${'  '.repeat(depth)}${getNodeTypeName(node.type)}：${node.title}`,
        bullet: { level: Math.min(depth, 7) },
      }));
      appendToc(node.id, depth + 1);
    });
  };
  appendToc(null, 0);

  paragraphs.push(
    new Paragraph({ text: '世界设定', heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }),
    new Paragraph({ text: book.worldSetting || '暂无世界设定' }),
    new Paragraph({ text: '角色档案', heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }),
  );

  if (book.characters.length > 0) {
    const rows = [
      new TableRow({
        children: ['角色', '身份', '简介', '秘密'].map((label) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
        })),
      }),
      ...book.characters.map((char) => new TableRow({
        children: [char.name, char.role, char.description, char.secret].map((text) => new TableCell({
          children: [new Paragraph({ text: text || '—' })],
        })),
      })),
    ];
    paragraphs.push(new Paragraph({ text: '' }));
    paragraphs.push(new Paragraph({ text: '角色表见下方。' }));
    // Table gets injected later via special marker handling.
  }

  if (facts.length > 0) {
    paragraphs.push(new Paragraph({ text: '事实库', heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }));
    facts
      .filter((fact) => fact.status === 'active')
      .sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt)
      .forEach((fact) => {
        paragraphs.push(new Paragraph({ text: `${fact.locked ? '[锁定] ' : ''}${fact.statement}`, bullet: { level: 0 } }));
      });
  }

  if (materials.length > 0) {
    paragraphs.push(new Paragraph({ text: '素材库', heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }));
    materials
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((entry) => {
        paragraphs.push(new Paragraph({ text: `[${entry.type}] ${entry.title}`, bullet: { level: 0 } }));
        paragraphs.push(new Paragraph({ text: entry.content.slice(0, 180), indent: { left: 720 } }));
      });
  }

  paragraphs.push(new Paragraph({ text: '正文', heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }));

  const buildContent = (parentId: string | null, depth: number) => {
    getSortedChildren(nodes, parentId).forEach((node) => {
      const headingByDepth = [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6] as const;
      paragraphs.push(new Paragraph({
        text: `${getNodeTypeName(node.type)}：${node.title}`,
        heading: headingByDepth[Math.min(depth, headingByDepth.length - 1)],
        spacing: { before: 200, after: 120 },
      }));

      if (node.summary) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: node.summary, italics: true })] }));
      }

      const metaLines = buildSceneMetaLines(node);
      if (metaLines.length > 0) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: metaLines.join(' | '), color: '666666' })] }));
      }

      const nodeStates = characterStateMap[node.id] || [];
      if (nodeStates.length > 0) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: `角色状态：${nodeStates.map((state) => `${state.characterName}: ${[state.location, state.physicalState, state.knowledgeState, state.inventory].filter(Boolean).join(' / ') || '无补充'}`).join('；')}`, color: '666666' })],
        }));
      }

      if (node.content?.trim()) {
        node.content.split('\n').filter((paragraph) => paragraph.trim()).forEach((paragraph) => {
          paragraphs.push(new Paragraph({ text: paragraph, spacing: { after: 160 } }));
        });
      }

      buildContent(node.id, depth + 1);
    });
  };
  buildContent(null, 0);
  return paragraphs;
};

export const exportAsMarkdown = async (book: Book): Promise<string> => buildMarkdownFromBundle(await loadBundle(book));

export const exportAsText = async (book: Book): Promise<string> => buildTextFromBundle(await loadBundle(book));

export const exportPartial = async (
  book: Book,
  rootNodeId: string,
  format: 'markdown' | 'text'
): Promise<string> => {
  const allNodes = await getBookNodes(book.id);
  const rootNode = allNodes.find((node) => node.id === rootNodeId);
  if (!rootNode) {
    throw new Error('节点不存在');
  }

  const getSubtree = (nodeId: string): StoryNode[] => {
    const foundNode = allNodes.find((node) => node.id === nodeId);
    if (!foundNode) return [];
    const children = allNodes.filter((node) => node.parentId === nodeId);
    return [foundNode, ...children.flatMap((child) => getSubtree(child.id))];
  };

  const subtreeNodes = getSubtree(rootNodeId);
  if (format === 'markdown') {
    let markdown = `# ${rootNode.title}\n\n`;
    markdown += `> ${rootNode.summary}\n\n---\n\n`;
    if (rootNode.content) {
      markdown += `${rootNode.content}\n\n`;
    }

    const buildContent = (parentId: string, level: number): void => {
      subtreeNodes.filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order).forEach((node) => {
        markdown += `${'#'.repeat(Math.min(level + 1, 6))} ${node.title}\n\n`;
        if (node.content) markdown += `${node.content}\n\n`;
        buildContent(node.id, level + 1);
      });
    };

    buildContent(rootNodeId, 1);
    return markdown;
  }

  let text = `${rootNode.title}\n${'='.repeat(rootNode.title.length)}\n\n${rootNode.summary}\n\n`;
  if (rootNode.content) {
    text += `${rootNode.content}\n\n`;
  }

  const buildContent = (parentId: string, indent: string): void => {
    subtreeNodes.filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order).forEach((node) => {
      text += `${indent}${node.title}\n`;
      if (node.content) text += `\n${node.content}\n\n`;
      buildContent(node.id, `${indent}  `);
    });
  };

  buildContent(rootNodeId, '');
  return text;
};

export const downloadFile = (content: Blob | BlobPart, filename: string, mimeType = 'text/plain;charset=utf-8') => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportAsHTML = async (book: Book): Promise<string> => buildHtmlFromBundle(await loadBundle(book));

export const exportAsDocx = async (book: Book): Promise<Blob> => {
  const bundle = await loadBundle(book);
  const characterRows = [
    new TableRow({
      children: ['角色', '身份', '简介', '秘密'].map((label) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
      })),
    }),
    ...book.characters.map((char) => new TableRow({
      children: [char.name, char.role, char.description, char.secret].map((text) => new TableCell({
        children: [new Paragraph({ text: text || '—' })],
      })),
    })),
  ];

  const doc = new Document({
    sections: [{
      children: [
        ...buildDocxParagraphs(bundle),
        ...(book.characters.length > 0 ? [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: characterRows,
        })] : []),
      ],
    }],
  });

  return Packer.toBlob(doc);
};

export const exportAsEpub = async (book: Book): Promise<Uint8Array> => {
  const bundle = await loadBundle(book);
  const markdown = buildMarkdownFromBundle(bundle);
  const title = escapeHtml(book.title);
  const safeTitle = sanitizeFilename(book.title);
  const identifier = `urn:dreamweaver:${safeTitle.toLowerCase()}`;

  const stylesheet = `
body { font-family: 'Source Han Serif SC', 'Noto Serif CJK SC', serif; line-height: 1.8; margin: 0; padding: 0 1.2rem; color: #222; }
h1, h2, h3, h4 { color: #111; }
p { text-indent: 2em; margin: 0 0 1em; }
blockquote { margin: 0 0 1rem; padding-left: 1rem; border-left: 3px solid #cbd5e1; color: #475569; }
ul { padding-left: 1.25rem; }
`;

  const paragraphs = markdown
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith('# ')) return `<h1>${escapeHtml(block.slice(2))}</h1>`;
      if (block.startsWith('## ')) return `<h2>${escapeHtml(block.slice(3))}</h2>`;
      if (block.startsWith('### ')) return `<h3>${escapeHtml(block.slice(4))}</h3>`;
      if (block.startsWith('#### ')) return `<h4>${escapeHtml(block.slice(5))}</h4>`;
      if (block.startsWith('> ')) return `<blockquote>${escapeHtml(block.slice(2))}</blockquote>`;
      if (block.startsWith('- ')) {
        const items = block.split('\n').filter((line) => line.startsWith('- ')).map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return block.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('');
    })
    .join('\n');

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeHtml(identifier)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="styles/book.css" media-type="text/css"/>
    <item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>
    <item id="manuscript" href="text/manuscript.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="title"/>
    <itemref idref="manuscript"/>
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>目录</title>
    <link rel="stylesheet" type="text/css" href="styles/book.css" />
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
        <li><a href="text/title.xhtml">封面与信息</a></li>
        <li><a href="text/manuscript.xhtml">正文</a></li>
      </ol>
    </nav>
  </body>
</html>`;

  const titlePage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${title}</title>
    <link rel="stylesheet" type="text/css" href="../styles/book.css" />
  </head>
  <body>
    <h1>${title}</h1>
    <p>${escapeHtml(book.premise)}</p>
    <h2>世界设定</h2>
    <p>${escapeHtml(book.worldSetting)}</p>
  </body>
</html>`;

  const manuscriptPage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <title>${title} 正文</title>
    <link rel="stylesheet" type="text/css" href="../styles/book.css" />
  </head>
  <body>
    ${paragraphs}
  </body>
</html>`;

  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(contentOpf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/styles/book.css': strToU8(stylesheet),
    'OEBPS/text/title.xhtml': strToU8(titlePage),
    'OEBPS/text/manuscript.xhtml': strToU8(manuscriptPage),
  });
};
