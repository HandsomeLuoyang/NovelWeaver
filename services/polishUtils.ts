export const extractPolishedSegment = (rawResponse: string): string => {
  const raw = rawResponse.trim();
  if (!raw) return '';

  const tagged = raw.match(/<POLISHED>\s*([\s\S]*?)\s*<\/POLISHED>/i);
  if (tagged?.[1]) {
    return tagged[1].trim();
  }

  const withoutFence = raw
    .replace(/^```[a-zA-Z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  return withoutFence;
};
