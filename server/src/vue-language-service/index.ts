import { Diagnostic, Hover } from 'vscode-languageserver';
import { Position } from 'vscode-languageserver-textdocument';
import VueTextDocuments, { VueTextDocument } from './documents';
import { getFileName, getPropertyName, htmlLanguageService } from './host';
import { TokenType } from 'vscode-html-languageservice';
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
            switch(scanner.getTokenType()) {
                case TokenType.AttributeValue:
                    const attribute = tokens[tokens.length - 3];
                    const isDynamicAttribute = attribute.startsWith(":");
                    if (isDynamicAttribute) {
                        // 从 render 函数获取
                        return getHoverFromRender(documents, document, position);
                    }
                    break;

                case TokenType.Content:
                    const content = scanner.getTokenText();
                    const index = offset - (node.startTagEnd || node.start);
                    // 左侧
                    let rightMarkIndex = content.lastIndexOf("}}", index);
                    let leftMarkIndex = content.lastIndexOf("{{", index);
                    const leftValid =  leftMarkIndex !== -1 && leftMarkIndex > rightMarkIndex;
                    // 右侧
                    if (leftValid) {
                        rightMarkIndex = content.indexOf("}}", index);
                        leftMarkIndex = content.indexOf("{{", index);
                        if (leftMarkIndex === -1) {
                            leftMarkIndex = Infinity;
                        }
                        const rightValid = rightMarkIndex !== -1 && rightMarkIndex < leftMarkIndex;
                        if (rightValid) {
                            return getHoverFromRender(documents, document, position);
                        }
                    }
                    break;
            }
            if (document.htmlDocument.findNodeAt(offset).tag === "script") {
                return htmlLanguageService.doHover(document, position, document.htmlDocument);
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
            const name = document.getText().slice(start, end);
            const { model, props, computedProps, datas, methods } = document.vueComponent;
            let type = "";
            if (model && getPropertyName(model) === name) {
                type = "model";
            } else if (props.find(prop => getPropertyName(prop) === name)) {
                type = "property";
            } else if (computedProps.find(prop => getPropertyName(prop) === name)) {
                type = "computed";
            } else if (datas.find(data => getPropertyName(data) === name)) {
                type = "data";
            } else if (methods.find(method => getPropertyName(method) === name)) {
                type = "method";
            }
            if (type) {
                first.text = `(${type}) ${document.vueComponent.name}`;
                if (quickInfo.displayParts[1]) {
                    quickInfo.displayParts[1].text = ".";
                }
            }
        }
        const content = quickInfo.displayParts.map(v => v.text).join("") || "";
        return {
            range: {
                start: document.positionAt(start),
                end: document.positionAt(end),
            },
            contents: [
                ...(quickInfo.documentation || []).map(item => ({ language: item.kind, value: item.text})),
                {
                    language: "js",
                    value: content
                }
            ]
        };
    }
    return null;
}
