import { isGenerating } from '../../../../../script.js';
import {
    extension_settings,
    extensionName,
    fillPromptTemplate,
    getContext,
    getPromptValue,
    requestCompletion,
    setLastImpersonateResult,
    setPreviousImpersonateInput,
    shouldUseDirectCall,
} from './persistentGuides/guideExports.js';

let previewPending = false;
let lastAccepted;

function getChatKey(context) {
    if (!context) return null;
    return JSON.stringify([context.groupId || null, context.groupId ? null : context.characterId, context.getCurrentChatId()]);
}

export async function runGuidedImpersonate(perspective) {
    if (previewPending) return;
    const textarea = document.getElementById('send_textarea');
    const context = getContext();
    if (!textarea || !context) return;

    const draft = textarea.value;
    const chatKey = getChatKey(context);
    const matchesDraft = () => document.getElementById('send_textarea') === textarea
        && textarea.value === draft
        && getChatKey(getContext()) === chatKey;

    if (lastAccepted?.chatKey === chatKey && lastAccepted.suggestion === draft) {
        textarea.value = lastAccepted.draft;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        lastAccepted = undefined;
        return;
    }

    previewPending = true;
    try {
        const settings = extension_settings[extensionName];
        const profileName = settings?.[`profileImpersonate${perspective}`] ?? '';
        const presetName = settings?.[`presetImpersonate${perspective}`] ?? '';
        const template = await getPromptValue(`promptImpersonate${perspective}`, '', { settings });
        const prompt = fillPromptTemplate(template, { input: draft });
        const direct = await shouldUseDirectCall(profileName, presetName);

        if (!matchesDraft()) {
            toastr.info('The draft or chat changed. Run Guided Impersonate again to preview it.');
            return;
        }
        if (isGenerating()) {
            toastr.info('Wait for the current generation to finish before previewing a draft.');
            return;
        }

        let forceChId;
        if (!direct && context.groupId) {
            const group = context.groups.find(group => String(group.id) === String(context.groupId));
            const members = group?.members
                .map(avatar => context.characters.findIndex(character => character.avatar === avatar))
                .filter(id => id >= 0);
            if (!members?.length) {
                toastr.warning('Add a character to the group before previewing a draft.');
                return;
            }
            // A native quiet group call with no selected member can send the composer as a user message.
            forceChId = members[Math.floor(Math.random() * members.length)];
        }

        // Native /impersonate streams into the composer. Quiet generation returns the text for review.
        const suggestion = direct
            ? await requestCompletion({
                profileName,
                presetName,
                prompt,
                debugLabel: `impersonate:${perspective}`,
                includeChatHistory: true,
                includeIdentityContext: true,
            })
            : await context.generateQuietPrompt({
                quietPrompt: `${prompt}\n\nReturn only the message for {{user}} to send. Follow the requested perspective.`,
                quietName: context.name1,
                forceChId,
            });

        if (typeof suggestion !== 'string' || !suggestion.trim()) {
            toastr.warning('No draft suggestion was generated.');
            return;
        }
        if (!matchesDraft()) {
            toastr.info('The draft or chat changed. Run Guided Impersonate again to preview it.');
            return;
        }

        const preview = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = 'Suggested draft';
        const text = document.createElement('p');
        text.textContent = suggestion;
        text.style.whiteSpace = 'pre-wrap';
        text.style.overflowWrap = 'anywhere';
        preview.append(title, text);

        const result = await context.callGenericPopup(preview, context.POPUP_TYPE.CONFIRM, '', {
            okButton: 'Accept',
            cancelButton: 'Dismiss',
            defaultResult: context.POPUP_RESULT.NEGATIVE,
            allowVerticalScrolling: true,
            leftAlign: true,
        });
        if (result !== context.POPUP_RESULT.AFFIRMATIVE) return;
        if (!matchesDraft()) {
            toastr.info('The draft or chat changed. Run Guided Impersonate again to preview it.');
            return;
        }

        setPreviousImpersonateInput(draft);
        setLastImpersonateResult(suggestion);
        lastAccepted = { chatKey, draft, suggestion };
        textarea.value = suggestion;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
    } catch (error) {
        console.error(`[GuidedGenerations] Error generating a ${perspective} person draft:`, error);
        toastr.error('Could not preview a draft. Try Guided Impersonate again.');
    } finally {
        previewPending = false;
    }
}

export const guidedImpersonate = () => runGuidedImpersonate('1st');
