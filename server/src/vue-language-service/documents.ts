import * as ts from "typescript";
import {
    DocumentUri,
    TextDocumentContentChangeEvent,
    TextDocuments,
    TextDocumentsConfiguration,
    TextEdit
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HTMLDocument } from "vscode-html-languageservice";
import { getServicesHost } from './host';
import { VueComponent } from './parse';
import { PositionManager } from './position';

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
        return TextDocument.create(uri, languageId, version, content) as VueTextDocument;
    },

    update(document: VueTextDocument, changes: TextDocumentContentChangeEvent[], version: number): VueTextDocument {
        return TextDocument.update(document, changes, version) as VueTextDocument;
    },

    applyEdits(document: TextDocument, edits: TextEdit[]): string {
        return TextDocument.applyEdits(document, edits);
    }
};

/** 基于 TextDocument 扩展，包含 vue 文件所需的信息 */
export interface VueTextDocument extends TextDocument {
    /** 文本解析出来的 html 文档 */
	htmlDocument: HTMLDocument;
    /** 文本解析出来的 vue 组件信息 */
    vueComponent: VueComponent;
    /** render 函数开始位置 */
    renderStart: number;
    /** render 函数的位置管理器 */
    position: PositionManager;
}