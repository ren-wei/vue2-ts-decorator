import { DocumentUri, TextDocumentContentChangeEvent, TextDocuments, TextDocumentsConfiguration, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService, HTMLDocument } from "vscode-html-languageservice";

const htmlLanguageService = getLanguageService();

export default class VueTextDocuments extends TextDocuments<VueTextDocument> {
}

export interface VueTextDocument extends TextDocument {
	htmlDocument: HTMLDocument;
}

export const configuration = {
    create(uri: DocumentUri, languageId: string, version: number, content: string): VueTextDocument {
        const textDocument = TextDocument.create(uri, languageId, version, content) as VueTextDocument;
        textDocument.htmlDocument = htmlLanguageService.parseHTMLDocument(textDocument);
        return textDocument;
    },

    update(document: TextDocument, changes: TextDocumentContentChangeEvent[], version: number): VueTextDocument {
        const textDocument = TextDocument.update(document, changes, version) as VueTextDocument;
        textDocument.htmlDocument = htmlLanguageService.parseHTMLDocument(textDocument);
        return textDocument;
    },

    applyEdits(document: TextDocument, edits: TextEdit[]): string {
        return TextDocument.applyEdits(document, edits);
    }
};