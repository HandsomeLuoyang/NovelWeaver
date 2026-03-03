import { z } from 'zod';

export const CharacterSchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string(),
  secret: z.string(),
});

export const VolumeSchema = z.object({
  title: z.string(),
  summary: z.string(),
});

export const GenesisResponseSchema = z.object({
  title: z.string(),
  premise: z.string(),
  worldSetting: z.string(),
  characters: z.array(CharacterSchema),
  initialVolumes: z.array(VolumeSchema),
});

export const ExpansionNodeSchema = z.object({
  title: z.string(),
  summary: z.string(),
});

export const ExpansionResponseSchema = z.object({
  nodes: z.array(ExpansionNodeSchema),
});

export type GenesisResponse = z.infer<typeof GenesisResponseSchema>;
export type ExpansionResponse = z.infer<typeof ExpansionResponseSchema>;
