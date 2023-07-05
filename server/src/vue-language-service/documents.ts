import * as ts from "typescript";
import { DocumentUri, TextDocumentContentChangeEvent, TextDocuments, TextDocumentsConfiguration, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService, HTMLDocument } from "vscode-html-languageservice";
import { getServicesHost } from './host';

const htmlLanguageService = getLanguageService();

/** 基于 @see TextDocuments 扩展，提供操作 @see VueTextDocument 的方法 */
export default class VueTextDocuments extends TextDocuments<VueTextDocument> {
    public tsLanguageService: ts.LanguageService;

    constructor(configuration: TextDocumentsConfiguration<VueTextDocument>) {
        super(configuration);
        this.tsLanguageService = ts.createLanguageService(getServicesHost(this));
    }
}

/** @see VueTextDocuments 初始化配置 */
export const VueTextDocument = {
    create(uri: DocumentUri, languageId: string, version: number, content: string): VueTextDocument {
        const document = TextDocument.create(uri, languageId, version, content) as VueTextDocument;
        document.htmlDocument = htmlLanguageService.parseHTMLDocument(document);
        return document;
    },

    update(document: VueTextDocument, changes: TextDocumentContentChangeEvent[], version: number): VueTextDocument {
        const textDocument = TextDocument.update(document, changes, version) as VueTextDocument;
        textDocument.htmlDocument = htmlLanguageService.parseHTMLDocument(document);
        return textDocument;
    },

    applyEdits(document: TextDocument, edits: TextEdit[]): string {
        return TextDocument.applyEdits(document, edits);
    }
};

/** 基于 TextDocument 扩展，包含 vue 文件所需的信息 */
export interface VueTextDocument extends TextDocument {
	htmlDocument: HTMLDocument;
}