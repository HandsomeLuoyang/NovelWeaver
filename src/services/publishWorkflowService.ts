import { Book, FactEntry, ForeshadowEntry, StoryNode } from '../types';
import { runConsistencyCheck } from './consistencyService';

export interface PublishBlocker {
  id: string;
  message: string;
  nodeId?: string;
  suggestion?: string;
}

export interface PublishStage {
  id: 'outline' | 'draft' | 'review' | 'release';
  title: string;
  passed: boolean;
  description: string;
  blockers: PublishBlocker[];
}

export interface PublishWorkflowReport {
  qualityScore: number;
  draftCoverage: number;
  outlineCompleteness: number;
  metadataCoverage: number;
  unresolvedForeshadows: number;
  findingsSummary: {
    high: number;
    medium: number;
    low: number;
  };
  stages: PublishStage[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const evaluatePublishWorkflow = (
  book: Book,
  nodes: StoryNode[],
  facts: FactEntry[] = [],
  foreshadows: ForeshadowEntry[] = []
): PublishWorkflowReport => {
  const findings = runConsistencyCheck(book, nodes, facts);
  const high = findings.filter((finding) => finding.severity === 'high').length;
  const medium = findings.filter((finding) => finding.severity === 'medium').length;
  const low = findings.filter((finding) => finding.severity === 'low').length;

  const structuralNodes = nodes.filter((node) => node.type !== 'scene');
  const structuralChildrenCount = new Map<string, number>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    structuralChildrenCount.set(node.parentId, (structuralChildrenCount.get(node.parentId) || 0) + 1);
  });

  const nonEmptyStructural = structuralNodes.filter((node) => (structuralChildrenCount.get(node.id) || 0) > 0).length;
  const outlineCompleteness = structuralNodes.length === 0 ? 0 : nonEmptyStructural / structuralNodes.length;

  const sceneNodes = nodes.filter((node) => node.type === 'scene');
  const draftedSceneCount = sceneNodes.filter((node) => node.status === 'drafted' && (node.content || '').trim().length > 50).length;
  const draftCoverage = sceneNodes.length === 0 ? 0 : draftedSceneCount / sceneNodes.length;

  const metadataReadyCount = sceneNodes.filter((node) => {
    const meta = node.meta;
    if (!meta) return false;
    return Boolean(meta.pov || meta.timeTag || meta.location || meta.conflictType || (meta.participants && meta.participants.length > 0));
  }).length;
  const metadataCoverage = sceneNodes.length === 0 ? 0 : metadataReadyCount / sceneNodes.length;

  const penalty = high * 15 + medium * 6 + low * 2;
  const scoreBase = outlineCompleteness * 25 + draftCoverage * 45 + metadataCoverage * 15 + (1 - clamp(penalty / 100, 0, 1)) * 15;
  const qualityScore = clamp(Math.round(scoreBase), 0, 100);
  const unresolvedForeshadows = foreshadows.filter((entry) => entry.status === 'seeded' || entry.status === 'progressed').length;
  const firstUnresolvedForeshadow = foreshadows.find((entry) => entry.status === 'seeded' || entry.status === 'progressed');

  const toBlockers = (severity: 'high' | 'medium' | 'low', limit: number): PublishBlocker[] => {
    return findings
      .filter((finding) => finding.severity === severity)
      .slice(0, limit)
      .map((finding) => ({
        id: finding.id,
        message: finding.description,
        nodeId: finding.nodeId,
        suggestion: finding.nodeId
          ? '点击定位后，优先修复该节点的摘要/正文/元数据。'
          : '建议先处理该一致性问题，再进入下一阶段。',
      }));
  };

  const firstEmptyStruct = structuralNodes.find((node) => (structuralChildrenCount.get(node.id) || 0) === 0);
  const firstUndraftedScene = sceneNodes.find((node) => !(node.status === 'drafted' && (node.content || '').trim().length > 50));

  const stages: PublishStage[] = [
    {
      id: 'outline',
      title: '大纲门禁',
      description: '结构节点完整且层级基本闭合',
      passed: outlineCompleteness >= 0.8,
      blockers: outlineCompleteness >= 0.8
        ? []
        : [
            {
              id: 'outline-gap',
              message: '结构节点存在空洞，请先补齐子节点。',
              nodeId: firstEmptyStruct?.id,
              suggestion: firstEmptyStruct
                ? `建议优先补齐「${firstEmptyStruct.title}」的下一层级。`
                : '建议先补齐卷/剧情/章节层级。',
            },
          ],
    },
    {
      id: 'draft',
      title: '草稿门禁',
      description: '场景草稿覆盖率达到 70% 以上',
      passed: draftCoverage >= 0.7,
      blockers: draftCoverage >= 0.7
        ? []
        : [
            {
              id: 'draft-coverage',
              message: '草稿覆盖率不足 70%，建议继续补写场景正文。',
              nodeId: firstUndraftedScene?.id,
              suggestion: firstUndraftedScene
                ? `建议优先补写「${firstUndraftedScene.title}」。`
                : '建议优先完成未起草场景。',
            },
          ],
    },
    {
      id: 'review',
      title: '审校门禁',
      description: '高优先级一致性问题必须清零',
      passed: high === 0,
      blockers: high === 0
        ? []
        : [
            {
              id: 'high-findings',
              message: `仍有 ${high} 个高优先级一致性问题。`,
              suggestion: '请逐条定位并修复，再进入发布阶段。',
            },
            ...toBlockers('high', 5),
          ],
    },
    {
      id: 'release',
      title: '发布门禁',
      description: '质量评分达到 85 分以上且全书可读',
      passed: qualityScore >= 85 && draftCoverage >= 0.95 && high === 0 && unresolvedForeshadows === 0,
      blockers: qualityScore >= 85 && draftCoverage >= 0.95 && high === 0 && unresolvedForeshadows === 0
        ? []
        : [
            {
              id: 'release-threshold',
              message: '未达到发布阈值（评分>=85、草稿覆盖>=95%、高优先级问题为0）。',
              suggestion: '先补齐草稿覆盖率，再清空高优先级一致性问题。',
            },
            ...(unresolvedForeshadows > 0
              ? [{
                  id: 'foreshadow-unresolved',
                  message: `仍有 ${unresolvedForeshadows} 条伏笔未回收。`,
                  nodeId: firstUnresolvedForeshadow?.setupNodeId || firstUnresolvedForeshadow?.payoffNodeId,
                  suggestion: '请在伏笔管理器中推进到“已回收”或标记“弃坑”。',
                }]
              : []),
            ...toBlockers('high', 3),
            ...toBlockers('medium', 2),
          ],
    },
  ];

  return {
    qualityScore,
    draftCoverage,
    outlineCompleteness,
    metadataCoverage,
    unresolvedForeshadows,
    findingsSummary: { high, medium, low },
    stages,
  };
};
