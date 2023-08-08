import {
    createConnection,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    HoverParams,
    TextDocuments,
    Definition,
    DefinitionParams,
} from "vscode-languageserver/node";
import VueLanguageService from "./vue-language-service";
import { TextDocument } from "vscode-languageserver-textdocument";

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
        capabilities.textDocument
		&& capabilities.textDocument.publishDiagnostics
		&& capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                triggerCharacters: [":"],
            },
            hoverProvider: true,
            definitionProvider: true,
        },
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true,
            },
        };
    }
    return result;
});

connection.onInitialized(async() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(event => {
            connection.console.log("Workspace folder change event received.");
        });
    }
    const workspaceFolders = await connection.workspace.getWorkspaceFolders();
    const vueLanguageService = new VueLanguageService(documents, workspaceFolders);

    connection.onHover(
        (params: HoverParams) => {
            const document = documents.get(params.textDocument.uri);
            if (document) {
                return vueLanguageService.doHover(document, params.position);
            }
        }
    );

    connection.onCompletion(
        (params: TextDocumentPositionParams): CompletionItem[] => {
            const document = documents.get(params.textDocument.uri);
            if (document) {
                return vueLanguageService.doComplete(document, params.position);
            }
            return [];
        }
    );

    connection.onDefinition(
        (params: DefinitionParams): Definition => {
            const document = documents.get(params.textDocument.uri);
            if (document) {
                return vueLanguageService.doDefinition(document, params.position);
            }
            return [];
        }
    );
});

connection.onHover(
    (params: HoverParams) => {
        return null;
    }
);

connection.onCompletion(
    (params: TextDocumentPositionParams): CompletionItem[] => {
        return [];
    }
);

connection.onDefinition(
    (params: DefinitionParams): Definition => {
        return [];
    }
);

const documents = new TextDocuments(TextDocument);
documents.listen(connection);

connection.listen();
