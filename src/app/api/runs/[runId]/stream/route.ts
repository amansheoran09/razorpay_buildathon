import { readProgress } from '../../progress';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events for run progress. One event per 25 records is emitted by
 * the engine; this simply relays whatever has accumulated.
 */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0;
      const send = (data: unknown): void => {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));
      };

      for (let tick = 0; tick < 600; tick++) {
        const { events, done, error } = readProgress(runId, cursor);
        cursor += events.length;
        for (const event of events) send({ type: 'progress', ...event });
        if (done) {
          send({ type: 'done', run_id: runId, error });
          controller.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      send({ type: 'timeout', run_id: runId });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
