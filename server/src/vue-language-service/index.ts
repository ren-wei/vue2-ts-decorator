import { Diagnostic, Hover, MarkupKind } from 'vscode-languageserver';
import { Position } from 'vscode-languageserver-textdocument';
import VueTextDocuments, { VueTextDocument } from './documents';
import { getFileName } from './host';
import { TokenType, getLanguageService } from 'vscode-html-languageservice';
import { getNodeTokens } from './parse';

/**
 * 获取 vue 文件的语言服务器
 * 
 * 当文档变更时，需要解析的必要信息
 * 
 * @param documents 文档管理器
 * @returns 语言服务器
 */
export function getVueLanguageService(documents: VueTextDocuments) {
    return {
        /** 获取模版中的诊断信息 */
        getDiagnostics(document: VueTextDocument): Diagnostic[] {
            const tsLanguageService = documents.tsLanguageService;
            let diagnostics = tsLanguageService.getSemanticDiagnostics(getFileName(document));
            diagnostics = diagnostics.filter(diagnostic => diagnostic.start && diagnostic.start > document.renderStart);
            return diagnostics.map(diagnostic => {
                const start = document.position.positionAtSource((diagnostic.start || 0));
                const end = start + (diagnostic.length || 0);
                return {
                    range: {
                        start: document.positionAt(start),
                        end: document.positionAt(end),
                    },
                    message: diagnostic.messageText.toString()
                };
            });
        },

        /** 鼠标悬浮显示信息 */
        doHover(document: VueTextDocument, position: Position): Hover | null {
            const offset = document.offsetAt(position);
            const node = document.htmlDocument.findNodeAt(offset);
            const { scanner, tokens } = getNodeTokens(document, node, offset);
            if (scanner.getTokenType() === TokenType.AttributeValue) {
                if (tokens[tokens.length - 3].startsWith(":")) {
                    // 从 render 函数获取
                    return getHoverFromRender(documents, document, position);
                }
            }
            return null;
        }
    };
}

/** 从 render 函数获取 hover */
function getHoverFromRender(documents: VueTextDocuments, document: VueTextDocument, position: Position): Hover | null {
    const tsLanguageService = documents.tsLanguageService;
    const fileName = getFileName(document);
    const pos = document.position.positionAtTarget(document.offsetAt(position));
    const quickInfo = (tsLanguageService.getQuickInfoAtPosition(fileName, pos));
    if (quickInfo && quickInfo.displayParts) {
        const start = document.position.positionAtSource(quickInfo.textSpan.start);
        const end = start + quickInfo.textSpan.length;
        const first = quickInfo.displayParts[0];
        if (first.kind === 'keyword' && first.text === "const") {
            first.text = `(property) ${document.vueComponent.name}`;
            if (quickInfo.displayParts[1]) {
                quickInfo.displayParts[1].text = ".";
            }
        }
        const content = quickInfo.displayParts.map(v => v.text).join("") || "";
        return {
            range: {
                start: document.positionAt(start),
                end: document.positionAt(end),
            },
            contents: {
                kind: MarkupKind.Markdown,
                value: "```js\n" + content + "\n```"
            }
        };
    }
    return null;
}
