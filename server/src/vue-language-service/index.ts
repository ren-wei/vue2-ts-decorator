import * as ts from "typescript";
import { Diagnostic, Hover, TextDocuments } from 'vscode-languageserver';
import { Position, TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService, Node, Range } from "vscode-html-languageservice";
import { getTypescriptLanguageService, documentExpressRangeMap, getFileName } from "./ts-language-service";
import VueTextDocuments from './documents';

const htmlLanguageService = getLanguageService();

/**
 * 获取 vue 文件的语言服务器
 * 
 * 当文档变更时，需要解析的必要信息
 * 
 * @param documents 文档管理器
 * @returns 语言服务器
 */
export function getVueLanguageService(documents: VueTextDocuments) {
    let tsLanguageService = getTypescriptLanguageService(documents);
    return {
        /** 获取模版中的诊断信息 */
        getDiagnostics(document: TextDocument): Diagnostic[] {
            tsLanguageService = getTypescriptLanguageService(documents);
            const diagnostics = tsLanguageService.getSemanticDiagnostics(getFileName(document));
            const getExpressRange = documentExpressRangeMap.get(document.uri);
            if (getExpressRange) {
                return diagnostics.reduce((total, diagnostic) => {
                    const ranges = getExpressRange(diagnostic.start as number, diagnostic.length as number);
                    total.push(...ranges.map(range => ({ range, message: String(diagnostic.messageText) })));
                    return total;
                }, [] as Diagnostic[]);
            }
            return [];
        },

        doHover(document: TextDocument, position: Position): Hover | null {
            const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
            const template = htmlDocument.roots.find(root => root.tag === "template");
            return null;
        }
    };
}
