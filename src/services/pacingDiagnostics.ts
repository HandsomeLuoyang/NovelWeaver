import { StoryNode } from '../types';

export interface PacingFinding {
  id: string;
  severity: 'high' | 'medium' | 'low';
  nodeId?: string;
  title: string;
  description: string;
}

const flattenScenes = (nodes: StoryNode[]) => {
  const byParent = new Map<string | null, StoryNode[]>();
  nodes.forEach((node) => {
    const bucket = byParent.get(node.parentId) || [];
    bucket.push(node);
    byParent.set(node.parentId, bucket);
  });
  byParent.forEach((bucket) => bucket.sort((a, b) => a.order - b.order));

  const walk = (parentId: string | null): StoryNode[] => {
    const children = byParent.get(parentId) || [];
    return children.flatMap((child) => (child.type === 'scene' ? [child] : walk(child.id)));
  };

  return walk(null);
};

const countMatches = (text: string, pattern: RegExp) => (text.match(pattern) || []).length;

export const runPacingDiagnostics = (nodes: StoryNode[]) => {
  const scenes = flattenScenes(nodes);
  const findings: PacingFinding[] = [];

  scenes.forEach((scene, index) => {
    const text = `${scene.summary}\n${scene.content || ''}`;
    const contentLength = (scene.content || '').trim().length;
    const conflictHits = countMatches(text, /冲突|争执|枪|杀|追|逃|威胁|怒|痛|崩|危机|爆炸|审判|反击/g);
    const revealHits = countMatches(text, /真相|发现|得知|原来|秘密|线索|揭露|明白/g);

    if (contentLength > 2400 && conflictHits === 0 && revealHits === 0) {
      findings.push({
        id: `flat-scene-${scene.id}`,
        severity: 'medium',
        nodeId: scene.id,
        title: '场景张力偏平',
        description: `场景「${scene.title}」篇幅较长，但冲突与信息推进信号偏弱，建议补一个动作推进点或信息揭示点。`,
      });
    }

    if (index >= 2) {
      const recent = scenes.slice(index - 2, index + 1);
      const avgLength = recent.reduce((sum, item) => sum + (item.content || '').trim().length, 0) / recent.length;
      const totalConflict = recent.reduce((sum, item) => sum + countMatches(`${item.summary}\n${item.content || ''}`, /冲突|争执|威胁|反击|危机/g), 0);
      if (avgLength > 1800 && totalConflict <= 1) {
        findings.push({
          id: `slow-run-${scene.id}`,
          severity: 'high',
          nodeId: scene.id,
          title: '连续段落节奏偏慢',
          description: '最近连续 3 个场景篇幅偏长且冲突密度偏低，读者可能感到拖沓。',
        });
      }
    }
  });

  return {
    sceneCount: scenes.length,
    draftedCount: scenes.filter((scene) => (scene.content || '').trim().length > 0).length,
    findings,
  };
};
