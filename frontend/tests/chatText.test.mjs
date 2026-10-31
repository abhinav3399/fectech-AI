import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sanitizeReply,
    isPromptEcho,
    isEchoOfSpoken,
    isDuplicateTranscript,
    normalizeUserText,
} from '../src/lib/chatText.js';

test('strips a single role label', () => {
    assert.equal(sanitizeReply('Assistant: Hello there.'), 'Hello there.');
    assert.equal(sanitizeReply('User: Hi'), 'Hi');
});

test('strips stacked role labels', () => {
    assert.equal(sanitizeReply('User: Assistant: Hello.'), 'Hello.');
});

test('rejects severe prompt-label leakage instead of displaying it', () => {
    assert.equal(sanitizeReply('User: User: Time assistant User: Abhinav Panwar, Task Assistant.'), '');
});

test('collapses consecutive duplicate sentences', () => {
    assert.equal(sanitizeReply('I am here. I am here. How are you?'), 'I am here. How are you?');
});

test('keeps legitimate content intact', () => {
    assert.equal(sanitizeReply("It's so good to see you, Abhinav. How was your day?"), "It's so good to see you, Abhinav. How was your day?");
});

test('detects prompt echo', () => {
    assert.equal(isPromptEcho("The user's name is Abhinav."), true);
    assert.equal(isPromptEcho('How are you feeling today?'), false);
});

test('suppresses the avatar echo but not a real question', () => {
    assert.equal(isEchoOfSpoken('good morning', 'Good morning, Abhinav! How are you?'), true);
    assert.equal(isEchoOfSpoken('I feel tired', 'Good morning, Abhinav!'), false);
});

test('prevents the same transcript from being submitted twice within the window', () => {
    const last = { text: 'hello', at: 1000 };
    assert.equal(isDuplicateTranscript('hello', last, 2500), true);
    assert.equal(isDuplicateTranscript('hello', last, 9000), false);
    assert.equal(isDuplicateTranscript('something else', last, 1100), false);
    assert.equal(isDuplicateTranscript('', last, 1100), false);
});

test('normalizes user text and caps length', () => {
    assert.equal(normalizeUserText('  what   time  is it?  '), 'what time is it?');
    assert.equal(normalizeUserText('abcd', 2), 'ab');
    assert.equal(normalizeUserText(null), '');
});
