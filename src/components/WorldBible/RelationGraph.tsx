import React, { useMemo } from 'react';
import { Character, StoryNode } from '../../types';
import { Icons } from '../Icons';

interface RelationGraphProps {
  characters: Character[];
  nodes: StoryNode[];
}

interface EdgeRow {
  id: string;
  from: string;
  to: string;
  weight: number;
}

export const RelationGraph: React.FC<RelationGraphProps> = ({ characters, nodes }) => {
  const { mentionCount, edges } = useMemo(() => {
    const scenes = nodes.filter((node) => node.type === 'scene');
    const counts = new Map<string, number>();
    characters.forEach((character) => counts.set(character.name, 0));

    const edgeMap = new Map<string, EdgeRow>();

    scenes.forEach((scene) => {
      const sourceText = `${scene.title}\n${scene.summary}\n${scene.content || ''}`;

      const inferredParticipants = characters
        .map((character) => character.name.trim())
        .filter((name) => name.length > 0)
        .filter((name) => sourceText.includes(name));

      const explicitParticipants = (scene.meta?.participants || [])
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

      const participants = Array.from(new Set([...inferredParticipants, ...explicitParticipants]));

      participants.forEach((name) => {
        counts.set(name, (counts.get(name) || 0) + 1);
      });

      for (let i = 0; i < participants.length; i += 1) {
        for (let j = i + 1; j < participants.length; j += 1) {
          const pair = [participants[i], participants[j]].sort((a, b) => a.localeCompare(b));
          const edgeId = `${pair[0]}::${pair[1]}`;
          const current = edgeMap.get(edgeId);
          if (current) {
            current.weight += 1;
          } else {
            edgeMap.set(edgeId, {
              id: edgeId,
              from: pair[0],
              to: pair[1],
              weight: 1,
            });
          }
        }
      }
    });

    const sortedEdges = [...edgeMap.values()].sort((a, b) => b.weight - a.weight);
    return {
      mentionCount: counts,
      edges: sortedEdges,
    };
  }, [characters, nodes]);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground leading-6">
        基于场景正文与元数据中的“出场角色”自动统计。可用于快速检查角色关系热度。
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {characters.map((character) => (
          <div key={character.name} className="bg-secondary/30 rounded-lg border border-border p-3">
            <div className="text-xs text-foreground font-semibold truncate">{character.name}</div>
            <div className="text-[11px] text-muted-foreground mt-1">出场场景数</div>
            <div className="text-lg font-bold text-primary mt-1">{mentionCount.get(character.name) || 0}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-secondary/20 p-3">
        <div className="text-xs font-semibold text-foreground flex items-center gap-1 mb-2">
          <Icons.GitBranch size={12} className="text-primary" />
          关系边（共现次数）
        </div>

        {edges.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">暂无可识别的角色共现关系</div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
            {edges.map((edge) => (
              <div key={edge.id} className="flex items-center justify-between text-xs bg-background/60 border border-border rounded px-2 py-1.5">
                <div className="text-foreground/90 truncate">
                  {edge.from} ↔ {edge.to}
                </div>
                <div className="font-mono text-primary">{edge.weight}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
