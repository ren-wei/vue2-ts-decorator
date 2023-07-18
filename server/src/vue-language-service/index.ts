import * as ts from "typescript";
import { CompletionItem, CompletionItemKind, Diagnostic, Hover } from 'vscode-languageserver';
import { Position } from 'vscode-languageserver-textdocument';
import VueTextDocuments, { VueTextDocument } from './documents';
import { getFileName, getPropertyName, htmlLanguageService } from './host';
import { TokenType } from 'vscode-html-languageservice';
import { getNodeTokens } from './parse';
import { bindingReg } from './compile';

/**
 * 获取 vue 文件的语言服务器
 * 
 * 当文档变更时，需要解析的必要信息
 * 
 * @param documents 文档管理器
 * @returns 语言服务器
 */
export default class VueLanguageService {
    constructor(public documents: VueTextDocuments) {}

    /** 获取模版中的诊断信息 */
    public getDiagnostics(document: VueTextDocument): Diagnostic[] {
        const tsLanguageService = this.documents.tsLanguageService;
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
    }

    /** 鼠标悬浮显示信息 */
    public doHover(document: VueTextDocument, position: Position): Hover | null {
        if (this.isExpressionRange(document, position)) {
            return this.getHoverFromRender(document, position);
        }
        if (document.htmlDocument.findNodeAt(document.offsetAt(position)).tag === "script") {
            return htmlLanguageService.doHover(document, position, document.htmlDocument);
        }
        return null;
    }

    public doComplete(document: VueTextDocument, position: Position): CompletionItem[] {
        if (this.isExpressionRange(document, position)) {
            const tsLanguageService = this.documents.tsLanguageService;
            const fileName = getFileName(document);
            const pos = document.position.positionAtTarget(document.offsetAt(position));
            const completionInfoList = tsLanguageService.getCompletionsAtPosition(
                fileName,
                pos,
                {
                    includeSymbol: true,
                    includeCompletionsWithInsertText: true,
                }
            );
            if (completionInfoList) {
                const completionList = completionInfoList.entries
                    .filter(item => [
                        ts.ScriptElementKind.constElement,
                        ts.ScriptElementKind.memberVariableElement
                    ].includes(item.kind));
                return completionList.map(item => ({
                    label: item.name,
                    kind: tsKind2CompletionItemKind(item.kind)
                }));
            }
        }
        return [];
    }

    /** 是否处于表达式范围内 */
    private isExpressionRange(document: VueTextDocument, position: Position) {
        const offset = document.offsetAt(position);
        const node = document.htmlDocument.findNodeAt(offset);
        const { scanner, tokens } = getNodeTokens(document, node, offset);
        switch(scanner.getTokenType()) {
            case TokenType.AttributeValue:
                const attribute = tokens[tokens.length - 3];
                if (bindingReg.test(attribute)) {
                    return true;
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
                        return true;
                    }
                }
                break;
        }
    }

    /** 从 render 函数获取 hover */
    private getHoverFromRender(document: VueTextDocument, position: Position): Hover | null {
        const tsLanguageService = this.documents.tsLanguageService;
        const fileName = getFileName(document);
        const offset = document.position.positionAtTarget(document.offsetAt(position));
        const quickInfo = (tsLanguageService.getQuickInfoAtPosition(fileName, offset));
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
}

function tsKind2CompletionItemKind(kind: ts.ScriptElementKind): CompletionItemKind {
    return {
        [ts.ScriptElementKind.alias]: CompletionItemKind.Text,
        [ts.ScriptElementKind.callSignatureElement]: CompletionItemKind.Text,
        [ts.ScriptElementKind.classElement]: CompletionItemKind.Class,
        [ts.ScriptElementKind.constElement]: CompletionItemKind.Property,
        [ts.ScriptElementKind.constructSignatureElement]: CompletionItemKind.Constructor,
        [ts.ScriptElementKind.constructorImplementationElement]: CompletionItemKind.Constructor,
        [ts.ScriptElementKind.directory]: CompletionItemKind.Folder,
        [ts.ScriptElementKind.enumElement]: CompletionItemKind.Enum,
        [ts.ScriptElementKind.enumMemberElement]: CompletionItemKind.EnumMember,
        [ts.ScriptElementKind.externalModuleName]: CompletionItemKind.Module,
        [ts.ScriptElementKind.functionElement]: CompletionItemKind.Function,
        [ts.ScriptElementKind.indexSignatureElement]: CompletionItemKind.Text,
        [ts.ScriptElementKind.interfaceElement]: CompletionItemKind.Interface,
        [ts.ScriptElementKind.keyword]: CompletionItemKind.Keyword,
        [ts.ScriptElementKind.label]: CompletionItemKind.Value,
        [ts.ScriptElementKind.letElement]: CompletionItemKind.Text,
        [ts.ScriptElementKind.link]: CompletionItemKind.Text,
        [ts.ScriptElementKind.linkName]: CompletionItemKind.Text,
        [ts.ScriptElementKind.linkText]: CompletionItemKind.Text,
        [ts.ScriptElementKind.localClassElement]: CompletionItemKind.Class,
        [ts.ScriptElementKind.localFunctionElement]: CompletionItemKind.Function,
        [ts.ScriptElementKind.localVariableElement]: CompletionItemKind.Variable,
        [ts.ScriptElementKind.memberAccessorVariableElement]: CompletionItemKind.Variable,
        [ts.ScriptElementKind.memberFunctionElement]: CompletionItemKind.Function,
        [ts.ScriptElementKind.memberGetAccessorElement]: CompletionItemKind.Property,
        [ts.ScriptElementKind.memberSetAccessorElement]: CompletionItemKind.Property,
        [ts.ScriptElementKind.memberVariableElement]: CompletionItemKind.Property,
        [ts.ScriptElementKind.moduleElement]: CompletionItemKind.Module,
        [ts.ScriptElementKind.parameterElement]: CompletionItemKind.Text,
        [ts.ScriptElementKind.primitiveType]: CompletionItemKind.TypeParameter,
        [ts.ScriptElementKind.scriptElement]: CompletionItemKind.Text,
        [ts.ScriptElementKind.string]: CompletionItemKind.Text,
        [ts.ScriptElementKind.typeElement]: CompletionItemKind.TypeParameter,
        [ts.ScriptElementKind.typeParameterElement]: CompletionItemKind.TypeParameter,
        [ts.ScriptElementKind.unknown]: CompletionItemKind.Text,
        [ts.ScriptElementKind.variableElement]: CompletionItemKind.Variable,
        [ts.ScriptElementKind.warning]: CompletionItemKind.Text,
        [ts.ScriptElementKind.jsxAttribute]: CompletionItemKind.Field
    }[kind];
}
