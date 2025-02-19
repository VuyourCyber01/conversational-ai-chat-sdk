import type { Activity } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import type { Strategy } from '../../../types/Strategy';
import DirectToEngineServerSentEventsChatAdapterAPI from '../../DirectToEngineServerSentEventsChatAdapterAPI';
import asyncIterableToArray from '../../asyncIterableToArray';
import type { BotResponse } from '../../types/BotResponse';
import { parseConversationId } from '../../types/ConversationId';
import type { DefaultHttpResponseResolver } from '../../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../../types/JestMockOf';

const server = setupServer();

const NOT_MOCKED: DefaultHttpResponseResolver = () => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['rest' as const, 'server sent events' as const])('Using "%s" transport', transport => {
  let strategy: Strategy;

  beforeEach(() => {
    strategy = {
      async prepareExecuteTurn() {
        return Promise.resolve({
          baseURL: new URL('http://test/?api=execute#2'),
          body: { dummy: 'dummy' },
          headers: new Headers({ 'x-dummy': 'dummy' }),
          transport
        });
      },
      async prepareStartNewConversation() {
        return Promise.resolve({
          baseURL: new URL('http://test/?api=start#1'),
          body: { dummy: 'dummy' },
          headers: new Headers({ 'x-dummy': 'dummy' }),
          transport
        });
      }
    };
  });

  describe.each([true, false])('With emitStartConversationEvent of %s', emitStartConversationEvent => {
    let adapter: DirectToEngineServerSentEventsChatAdapterAPI;
    let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;

    beforeEach(() => {
      httpPostConversation = jest.fn(NOT_MOCKED);
      httpPostExecute = jest.fn(NOT_MOCKED);

      server.use(http.post('http://test/conversations', httpPostConversation));
      server.use(http.post('http://test/conversations/c-00001', httpPostExecute));

      adapter = new DirectToEngineServerSentEventsChatAdapterAPI(strategy, { retry: { factor: 1, minTimeout: 0 } });
    });

    describe('When conversation started and first turn completed', () => {
      let activities: Activity[];

      beforeEach(async () => {
        if (transport === 'rest') {
          httpPostConversation.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
              conversationId: parseConversationId('c-00001')
            } satisfies BotResponse)
          );
        } else {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );
        }

        const startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });

        activities = await asyncIterableToArray(startNewConversationResult);
      });

      test('should receive greeting activities', () =>
        expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }]));

      describe('when call startNewConversation again', () => {
        let startNewConversationResult: ReturnType<
          DirectToEngineServerSentEventsChatAdapterAPI['startNewConversation']
        >;

        beforeEach(() => {
          if (transport === 'rest') {
            httpPostConversation.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'waiting',
                activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }],
                conversationId: parseConversationId('c-00001')
              } satisfies BotResponse)
            );
          } else if (transport === 'server sent events') {
            httpPostConversation.mockImplementationOnce(
              () =>
                new HttpResponse(
                  Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Aloha!", "type": "message" }

event: end
data: end

`),
                  { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                )
            );
          }

          startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });
        });

        describe('when iterate', () => {
          let iteratePromise: Promise<unknown>;

          beforeEach(async () => {
            iteratePromise = startNewConversationResult.next();

            await iteratePromise.catch(() => {});
          });

          test('should reject', () =>
            expect(iteratePromise).rejects.toThrow('startNewConversation() cannot be called more than once.'));
        });
      });
    });
  });
});
