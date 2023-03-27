import {
    createConnection,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    TextDocumentPositionParams,
    InitializeResult,
} from 'vscode-languageserver/node';

import { getLanguageService as getHtmlLanguageService } from 'vscode-html-languageservice';
import { capabilities } from './config';
import documents from './documents';
import { validateTextDocument } from './validate';

const htmlLanguageService = getHtmlLanguageService();

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities,
    };
    return result;
});

connection.onInitialized(() => {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
    connection.workspace.onDidChangeWorkspaceFolders(event => {
        connection.console.log('Workspace folder change event received.');
    });
});

connection.onDidChangeConfiguration(change => {
    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});

connection.onDidChangeTextDocument((change) => {
    console.log('onDidChangeTextDocument');
});

connection.onDidChangeWatchedFiles(change => {
    // Monitored files have change in VSCode
    console.log('We received an file change event');
});

connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
    return htmlLanguageService.findDocumentSymbols(document, htmlDocument);
});

connection.onDocumentHighlight((params, token, workDoneProgress, resultProgress) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
    const result = htmlLanguageService.findDocumentHighlights(document, params.position, htmlDocument);
    return result;
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        const document = documents.get(textDocumentPosition.textDocument.uri);
        if (!document) {
            return [];
        }
        const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
        return htmlLanguageService.doComplete(document, textDocumentPosition.position, htmlDocument).items;
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        return item;
    }
);

connection.onHover((params, token, workDoneProgress, resultProgress) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
    return htmlLanguageService.doHover(document, params.position, htmlDocument);
});

documents.listen(connection);

// Listen on the connection
connection.listen();

export { connection };
