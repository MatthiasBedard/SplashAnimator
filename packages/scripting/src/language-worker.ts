import es5Library from 'typescript/lib/lib.es5.d.ts?raw';
import { createFrameLanguageService, type FrameLanguageRequest } from './language-service';
const service = createFrameLanguageService(es5Library);
self.onmessage = (event: MessageEvent) => {
  const { id, request } = event.data ?? {};
  if (!Number.isSafeInteger(id) || id < 1) return;
  try {
    self.postMessage({ id, result: service.request(request as FrameLanguageRequest) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Source language request failed.',
    });
  }
};
