import {
    createConnection,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    HoverParams
} from 'vscode-languageserver/node';
import VueLanguageService from "./vue-language-service";
import VueTextDocuments, { VueTextDocument } from './vue-language-service/documents';
import { getUri } from './vue-language-service/host';

const connection = createConnection(ProposedFeatures.all);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                triggerCharacters: ["."],
                resolveProvider: true
            },
            hoverProvider: true
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});

connection.onHover(
    (params: HoverParams) => {
        const document = documents.get(getUri(params.textDocument.uri));
        if (document) {
            return vueLanguageService.doHover(document, params.position);
        }
    }
);

connection.onCompletion(
    (params: TextDocumentPositionParams): CompletionItem[] => {
        const document = documents.get(getUri(params.textDocument.uri));
        if (document) {
            return vueLanguageService.doComplete(document, params.position);
        }
        return [];
    }
);

connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        return item;
    }
);

const documents = new VueTextDocuments(VueTextDocument);
documents.onDidChangeContent(({ document }) => {
    validateDocument(document);
});
documents.listen(connection);

connection.listen();

const vueLanguageService = new VueLanguageService(documents);

function validateDocument(document: VueTextDocument) {
    const diagnostics = vueLanguageService.getDiagnostics(document);
    connection.sendDiagnostics({
        uri: document.uri,
        diagnostics
    });
}
