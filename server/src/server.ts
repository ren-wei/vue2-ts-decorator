import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    Range,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService as getHtmlLanguageService, ColorPresentation } from 'vscode-html-languageservice';
import { capabilities } from './config';

const htmlLanguageService = getHtmlLanguageService();

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

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

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    // The validator creates diagnostics for all uppercase words length 2 and more
    const text = textDocument.getText();
    const pattern = /\b[A-Z]{2,}\b/g;
    let m: RegExpExecArray | null;

    let problems = 0;
    const diagnostics: Diagnostic[] = [];
    while ((m = pattern.exec(text))) {
        problems++;
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Warning,
            range: {
                start: textDocument.positionAt(m.index),
                end: textDocument.positionAt(m.index + m[0].length),
            },
            message: `${m[0]} is all uppercase.`,
            source: 'ex',
        };
        diagnostic.relatedInformation = [
            {
                location: {
                    uri: textDocument.uri,
                    range: Object.assign({}, diagnostic.range),
                },
                message: 'Spelling matters',
            },
            {
                location: {
                    uri: textDocument.uri,
                    range: Object.assign({}, diagnostic.range),
                },
                message: 'Particularly for names',
            },
        ];
        diagnostics.push(diagnostic);
    }

    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(change => {
    // Monitored files have change in VSCode
    connection.console.log('We received an file change event');
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

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
