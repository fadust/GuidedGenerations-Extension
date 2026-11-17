import { getContext, setPreviousImpersonateInput } from './persistentGuides/guideExports.js';
import { isGenerating } from '../../../../../script.js';
import { getMessageTimeStamp } from '../../../../RossAscends-mods.js';

let isSending = false;

export async function simpleSendCharacter() {
    if (isSending) return;

    const textarea = document.getElementById('send_textarea');
    const draft = textarea?.value;
    if (!draft?.trim()) return;

    const context = getContext();
    const character = context?.characters?.[context.characterId];
    const chatId = context?.getCurrentChatId();
    if (!chatId || !character?.name || context.groupId) {
        toastr.warning('Open a one-on-one character chat to send as that character.');
        return;
    }
    if (isGenerating()) {
        toastr.info('Wait for the current generation to finish.');
        return;
    }

    isSending = true;
    try {
        setPreviousImpersonateInput(draft);
        const timestamp = Date.now();
        const sendDate = getMessageTimeStamp(timestamp);
        const extra = { api: 'manual', model: 'Guided Generations', gen_id: timestamp };
        const message = {
            name: character.name,
            is_user: false,
            is_system: false,
            send_date: sendDate,
            // /sendas trims text and expands macros. Append the literal draft instead.
            mes: draft,
            extra,
            swipe_id: 0,
            swipes: [draft],
            swipe_info: [{ send_date: sendDate, gen_started: null, gen_finished: null, extra: { ...extra } }],
        };
        const chatIsCurrent = () => {
            const current = getContext();
            return current?.characterId === context.characterId && !current.groupId && current.getCurrentChatId() === chatId;
        };
        context.chatMetadata.tainted = true;
        const messageId = context.chat.push(message) - 1;
        await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, messageId, 'command');
        if (!chatIsCurrent()) return;
        context.addOneMessage(message);
        await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, messageId, 'command');
        if (!chatIsCurrent()) return;
        await context.saveChat();

        if (chatIsCurrent() && textarea.value === draft) {
            textarea.value = '';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } catch (error) {
        console.error('[GuidedGenerations][Simple Send: Character]', error);
        toastr.error('Could not send as the character. Your draft is still available.');
    } finally {
        isSending = false;
    }
}
