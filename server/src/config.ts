import { ServerCapabilities, TextDocumentSyncKind } from 'vscode-languageserver';

export const capabilities: ServerCapabilities = {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {
        resolveProvider: true,
    },
    hoverProvider: true,
    documentSymbolProvider: true,
    workspace: {
        workspaceFolders: {
            supported: true,
        },
    },
};
