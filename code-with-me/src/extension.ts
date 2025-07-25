// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

let ydoc: any = null;
let provider: any = null;
let yText: any = null;
let disposables: vscode.Disposable[] = [];
let shareStatusBarItem: vscode.StatusBarItem | undefined;
let lastSessionUrl: string | undefined;
let applyingRemoteUpdate = false;

const DEFAULT_PUBLIC_WS_URL = 'ws://localhost:1234';

export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeWithMe] Extension activated!');
    vscode.window.showInformationMessage('[CodeWithMe] Extension activated!');
    context.subscriptions.push(
        vscode.commands.registerCommand('code-with-me.sessionActions', showSessionActions),
        vscode.commands.registerCommand('code-with-me.joinSession', joinSession),
        vscode.commands.registerCommand('code-with-me.stopSession', stopSession),
        vscode.commands.registerCommand('code-with-me.shareSessionLink', shareSessionLink)
    );
    shareStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    shareStatusBarItem.text = '$(link) Share Code with me';
    shareStatusBarItem.command = 'code-with-me.sessionActions';
    shareStatusBarItem.tooltip = 'Share Code with me session link';
    shareStatusBarItem.show();
    context.subscriptions.push(shareStatusBarItem);
}

export function deactivate() {
    stopSession();
}

function stopSession() {
    vscode.window.showInformationMessage('[CodeWithMe] stopSession called');
    disposables.forEach(d => d.dispose());
    disposables = [];
    if (provider) { provider.destroy(); provider = null; }
    if (ydoc) { ydoc.destroy(); ydoc = null; }
    yText = null;
    vscode.window.showInformationMessage('Code with me session stopped.');
}

async function shareSessionLink() {
    vscode.window.showInformationMessage('[CodeWithMe] shareSessionLink called');
    // For local testing, always use ws://localhost:1234 and 'code-with-me-room'
    const link = DEFAULT_PUBLIC_WS_URL;
    await vscode.env.clipboard.writeText(link);
    vscode.window.showInformationMessage(`Invitation link copied to clipboard!`);
}

async function joinSession() {
    vscode.window.showInformationMessage('[CodeWithMe] joinSession called');
    const wsUrlOrLink = await vscode.window.showInputBox({
        prompt: 'Enter WebSocket server URL or invitation link',
        value: DEFAULT_PUBLIC_WS_URL
    });
    if (!wsUrlOrLink) { return; }
    lastSessionUrl = wsUrlOrLink;
    setupCollaboration(wsUrlOrLink, 'Guest', 'code-with-me-room');
}

async function setupCollaboration(wsUrl: string, role: string, sessionId: string = 'code-with-me-room') {
    vscode.window.showInformationMessage('[CodeWithMe] setupCollaboration called');
    vscode.window.showInformationMessage('[CodeWithMe] About to import Yjs and WebsocketProvider');
    sessionId = 'code-with-me-room';
    stopSession();
    let Y, WebsocketProvider;
    try {
        Y = await import('yjs');
        WebsocketProvider = (await import('y-websocket')).WebsocketProvider;
        vscode.window.showInformationMessage('[CodeWithMe] Successfully imported Yjs and WebsocketProvider');
        console.log('[CodeWithMe] Yjs and WebsocketProvider loaded.');
        vscode.window.showInformationMessage('[CodeWithMe] Yjs and WebsocketProvider loaded.');
    } catch (err) {
        vscode.window.showErrorMessage('[CodeWithMe] Failed to import Yjs or WebsocketProvider: ' + err);
        console.error('[CodeWithMe] Failed to load Yjs or WebsocketProvider:', err);
        vscode.window.showErrorMessage('Failed to load Yjs or WebsocketProvider.');
        return;
    }
    try {
        ydoc = new Y.Doc();
        provider = new WebsocketProvider(wsUrl, sessionId, ydoc);
        vscode.window.showInformationMessage('[CodeWithMe] Yjs and WebsocketProvider loaded.');
        provider.on('status', (event: any) => {
            console.log('[CodeWithMe] WebSocket status:', event.status);
            vscode.window.showInformationMessage(`[CodeWithMe] WebSocket status: ${event.status}`);
        });
        provider.on('sync', (isSynced: boolean) => {
            console.log('[CodeWithMe] Yjs sync event. Synced:', isSynced);
            vscode.window.showInformationMessage(`[CodeWithMe] Yjs sync event. Synced: ${isSynced}`);
        });
        yText = ydoc.getText('shared-text');
        console.log('[CodeWithMe] yText initialized.');
        vscode.window.showInformationMessage('[CodeWithMe] yText initialized.');
    } catch (err) {
        console.error('[CodeWithMe] Failed to initialize Yjs document or provider:', err);
        vscode.window.showErrorMessage('Failed to initialize Yjs document or provider.');
        return;
    }

    // No initial sync: do not overwrite guest's editor on join
    // Real-time sync: ensure event listeners are present

    // Granular sync: apply only the actual text changes, prevent feedback loop
    const docChange = vscode.workspace.onDidChangeTextDocument(e => {
        vscode.window.showInformationMessage('[CodeWithMe] Detected local document change');
        const editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document && yText && !applyingRemoteUpdate) {
            console.log('[CodeWithMe] Detected local document change:', e.contentChanges);
            e.contentChanges.forEach(change => {
                ydoc.transact(() => {
                    yText.delete(change.rangeOffset, change.rangeLength);
                    yText.insert(change.rangeOffset, change.text);
                });
                console.log('[CodeWithMe] Applied local change to Yjs:', change);
            });
        } else {
            if (!editor) console.log('[CodeWithMe] No active editor for doc change');
            if (e.document !== (editor && editor.document)) console.log('[CodeWithMe] Changed document is not the active editor document');
            if (!yText) console.log('[CodeWithMe] yText is not initialized');
            if (applyingRemoteUpdate) console.log('[CodeWithMe] Skipping local change due to applyingRemoteUpdate');
        }
    });
    disposables.push(docChange);

    // Apply only the actual Yjs changes to the editor
    const yjsChange = () => {
        vscode.window.showInformationMessage('[CodeWithMe] Yjs document changed!');
        const editor = vscode.window.activeTextEditor;
        if (editor && yText) {
            const current = editor.document.getText();
            const shared = yText.toString();
            if (current !== shared) {
                console.log('[CodeWithMe] Detected remote Yjs change. Updating editor.');
                applyingRemoteUpdate = true;
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(current.length)
                );
                edit.replace(editor.document.uri, fullRange, shared);
                vscode.workspace.applyEdit(edit).then(() => {
                    applyingRemoteUpdate = false;
                    console.log('[CodeWithMe] Applied Yjs change to editor.');
                });
            } else {
                console.log('[CodeWithMe] Yjs change detected but editor already matches shared content.');
            }
        } else {
            if (!editor) console.log('[CodeWithMe] No active editor for Yjs change');
            if (!yText) console.log('[CodeWithMe] yText is not initialized for Yjs change');
        }
    };
    yText.observe(yjsChange);
    disposables.push({ dispose: () => yText.unobserve(yjsChange) });

    // Listen for active editor changes and re-sync if needed
    const editorChange = vscode.window.onDidChangeActiveTextEditor(editor => {
        vscode.window.showInformationMessage('[CodeWithMe] Active editor changed');
        if (editor && yText) {
            const shared = yText.toString();
            const current = editor.document.getText();
            if (current !== shared) {
                console.log('[CodeWithMe] Active editor changed. Syncing with Yjs content.');
                applyingRemoteUpdate = true;
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(current.length)
                );
                edit.replace(editor.document.uri, fullRange, shared);
                vscode.workspace.applyEdit(edit).then(() => {
                    applyingRemoteUpdate = false;
                    console.log('[CodeWithMe] Synced new active editor with Yjs content.');
                });
            } else {
                console.log('[CodeWithMe] Active editor changed but content already matches Yjs.');
            }
        } else {
            if (!editor) console.log('[CodeWithMe] No active editor on editor change');
            if (!yText) console.log('[CodeWithMe] yText is not initialized on editor change');
        }
    });
    disposables.push(editorChange);

    vscode.window.showInformationMessage(`Code with me session started! Role: ${role}`);
    console.log('[CodeWithMe] Collaboration setup complete.');
}

async function showSessionActions() {
    vscode.window.showInformationMessage('[CodeWithMe] showSessionActions called');
    const action = await vscode.window.showQuickPick(
        [
            { label: 'Invite (Copy Link)', description: 'Share a join link' },
            { label: 'Join Session', description: 'Join a session with a link' },
            { label: 'Stop Session', description: 'Stop the current session' }
        ],
        { placeHolder: 'What would you like to do?' }
    );
    if (!action) return;
    if (action.label === 'Invite (Copy Link)') {
        vscode.window.showInformationMessage('[CodeWithMe] setupCollaboration called');
        await setupCollaboration(DEFAULT_PUBLIC_WS_URL, 'Host', 'code-with-me-room');
        await shareSessionLink();
    } else if (action.label === 'Join Session') {
        await joinSession();
    } else if (action.label === 'Stop Session') {
        stopSession();
    }
}
