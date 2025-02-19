import type { Activity } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import type { Strategy } from '../../types/Strategy';
import DirectToEngineServerSentEventsChatAdapterAPI from '../DirectToEngineServerSentEventsChatAdapterAPI';
import type { BotResponse } from '../types/BotResponse';
import { parseConversationId } from '../types/ConversationId';
import type { DefaultHttpResponseResolver } from '../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../types/JestMockOf';

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
    let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;

    beforeEach(() => {
      httpPostContinue = jest.fn(NOT_MOCKED);
      httpPostConversation = jest.fn(NOT_MOCKED);
      httpPostExecute = jest.fn(NOT_MOCKED);

      server.use(http.post('http://test/conversations', httpPostConversation));
      server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
      server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));

      adapter = new DirectToEngineServerSentEventsChatAdapterAPI(strategy, { retry: { factor: 1, minTimeout: 0 } });
    });

    describe('When conversation started and bot returned with 2 activities in 1 turn', () => {
      let startNewConversationResult: ReturnType<DirectToEngineServerSentEventsChatAdapterAPI['startNewConversation']>;

      beforeEach(() => {
        startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });
      });

      describe('after iterate once', () => {
        let iteratorResult: IteratorResult<Activity>;

        beforeEach(async () => {
          if (transport === 'rest') {
            httpPostConversation.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'waiting',
                activities: [
                  { from: { id: 'bot' }, text: 'Hello, World!', type: 'message' },
                  { from: { id: 'bot' }, text: 'Aloha!', type: 'message' }
                ],
                conversationId: parseConversationId('c-00001')
              } satisfies BotResponse)
            );
          } else if (transport === 'server sent events') {
            httpPostConversation.mockImplementationOnce(
              () =>
                new HttpResponse(
                  Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "Aloha!", "type": "message" }

event: end
data: end

`),
                  { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                )
            );
          }

          iteratorResult = await startNewConversationResult.next();
        });

        test('should have POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));

        test('should return the first activity', () =>
          expect(iteratorResult).toEqual({
            done: false,
            value: { from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }
          }));

        describe('after iterate twice', () => {
          let iteratorResult: IteratorResult<Activity>;

          beforeEach(async () => {
            iteratorResult = await startNewConversationResult.next();
          });

          test('should return the first activity', () =>
            expect(iteratorResult).toEqual({
              done: false,
              value: { from: { id: 'bot' }, text: 'Aloha!', type: 'message' }
            }));

          describe('after iterate the third time', () => {
            let iteratorResult: IteratorResult<Activity>;

            beforeEach(async () => {
              iteratorResult = await startNewConversationResult.next();
            });

            test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));

            describe('when execute turn and bot returned 2 activities in 1 turn', () => {
              let executeTurnResult: ReturnType<DirectToEngineServerSentEventsChatAdapterAPI['executeTurn']>;

              beforeEach(() => {
                executeTurnResult = adapter.executeTurn({ from: { id: 'u-00001' }, text: 'Morning.', type: 'message' });
              });

              describe('after iterate once', () => {
                let iteratorResult: IteratorResult<Activity>;

                beforeEach(async () => {
                  if (transport === 'rest') {
                    httpPostExecute.mockImplementationOnce(() =>
                      HttpResponse.json({
                        action: 'waiting',
                        activities: [
                          { from: { id: 'bot' }, text: 'Good morning!', type: 'message' },
                          { from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }
                        ]
                      } satisfies BotResponse)
                    );
                  } else if (transport === 'server sent events') {
                    httpPostExecute.mockImplementationOnce(
                      () =>
                        new HttpResponse(
                          Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Good morning!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "Goodbye!", "type": "message" }

event: end
data: end

`),
                          { headers: { 'content-type': 'text/event-stream' } }
                        )
                    );
                  }

                  iteratorResult = await executeTurnResult.next();
                });

                test('should return the third activity', () =>
                  expect(iteratorResult).toEqual({
                    done: false,
                    value: { from: { id: 'bot' }, text: 'Good morning!', type: 'message' }
                  }));

                describe('after iterate twice', () => {
                  let iteratorResult: IteratorResult<Activity>;

                  beforeEach(async () => {
                    iteratorResult = await executeTurnResult.next();
                  });

                  test('should return the fourth activity', () =>
                    expect(iteratorResult).toEqual({
                      done: false,
                      value: { from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }
                    }));

                  describe('after iterate the third time', () => {
                    let iteratorResult: IteratorResult<Activity>;

                    beforeEach(async () => {
                      iteratorResult = await executeTurnResult.next();
                    });

                    test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
