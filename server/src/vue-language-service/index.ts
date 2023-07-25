import * as ts from "typescript";
import { CompletionItem, CompletionItemKind, Diagnostic, Hover, InsertTextFormat } from "vscode-languageserver";
import { Position } from "vscode-languageserver-textdocument";
import VueTextDocuments, { VueTextDocument } from "./documents";
import { getFileName, getPropertyName, htmlLanguageService } from "./host";
import { TokenType } from "vscode-html-languageservice";
import { getNodeTokens } from "./parse";
import { bindingReg } from "./compile";

/**
 * 获取 vue 文件的语言服务器
 *
 * 当文档变更时，需要解析的必要信息
 *
 * @param documents 文档管理器
 * @returns 语言服务器
 */
export default class VueLanguageService {
    constructor(public documents: VueTextDocuments) {
        // TODO:
        documents;
    }

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
                message: diagnostic.messageText.toString(),
            };
        });
    }

    /** 鼠标悬浮显示信息 */
    public doHover(document: VueTextDocument, position: Position): Hover | null {
        if (this.getVueTokenType(document, position) === VueTokenType.DynamicAttributeValue) {
            return this.getHoverFromRender(document, position);
        }
        if (document.htmlDocument.findNodeAt(document.offsetAt(position)).tag !== "script") {
            return htmlLanguageService.doHover(document, position, document.htmlDocument);
        }
        return null;
    }

    /** 自动补全 */
    public doComplete(document: VueTextDocument, position: Position): CompletionItem[] {
        switch (this.getVueTokenType(document, position)) {
            case VueTokenType.DynamicAttributeValue:
                return this.getCompleteFromRender(document, position);
            case VueTokenType.ComponentNameContent:
                return this.getCompleteFromComponentNameContent(document, position);
            default:
                return htmlLanguageService.doComplete(document, position, document.htmlDocument).items;
        }
    }

    /** 获取当前所处的位置类型 */
    private getVueTokenType(document: VueTextDocument, position: Position): VueTokenType {
        const offset = document.offsetAt(position);
        const node = document.htmlDocument.findNodeAt(offset);
        const { scanner, tokens } = getNodeTokens(document, node, offset);
        switch (scanner.getTokenType()) {
            case TokenType.StartTag:
                const tag = (scanner.getTokenText());
                if (document.vueComponent.components.find(c => c.name === tag)) {
                    return VueTokenType.ComponentName;
                }
                break;
            case TokenType.AttributeValue:
                const attribute = tokens[tokens.length - 3];
                if (bindingReg.test(attribute)) {
                    return VueTokenType.DynamicAttributeValue;
                }
                break;

            case TokenType.Content:
                const content = scanner.getTokenText();
                if (/^\s*[A-Z][a-zA-Z0-9]*\s*$/.test(content)) {
                    return VueTokenType.ComponentNameContent;
                }
                const index = offset - (node.startTagEnd || node.start);
                // 左侧
                let rightMarkIndex = content.lastIndexOf("}}", index);
                let leftMarkIndex = content.lastIndexOf("{{", index);
                const leftValid = leftMarkIndex !== -1 && leftMarkIndex > rightMarkIndex;
                // 右侧
                if (leftValid) {
                    rightMarkIndex = content.indexOf("}}", index);
                    leftMarkIndex = content.indexOf("{{", index);
                    if (leftMarkIndex === -1) {
                        leftMarkIndex = Infinity;
                    }
                    const rightValid = rightMarkIndex !== -1 && rightMarkIndex < leftMarkIndex;
                    if (rightValid) {
                        return VueTokenType.DynamicAttributeValue;
                    }
                }
                break;
        }
        return VueTokenType.Other;
    }

    private getHoverFromRender(document: VueTextDocument, position: Position): Hover | null {
        const tsLanguageService = this.documents.tsLanguageService;
        const fileName = getFileName(document);
        const offset = document.position.positionAtTarget(document.offsetAt(position));
        const quickInfo = (tsLanguageService.getQuickInfoAtPosition(fileName, offset));
        if (quickInfo && quickInfo.displayParts) {
            const start = document.position.positionAtSource(quickInfo.textSpan.start);
            const end = start + quickInfo.textSpan.length;
            const first = quickInfo.displayParts[0];
            if (first.kind === "keyword" && first.text === "const") {
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
                    ...(quickInfo.documentation || []).map(item => ({ language: item.kind, value: item.text })),
                    {
                        language: "js",
                        value: content,
                    },
                ],
            };
        }
        return null;
    }

    private getCompleteFromRender(document: VueTextDocument, position: Position): CompletionItem[] {
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
                    ts.ScriptElementKind.memberVariableElement,
                ].includes(item.kind));
            return completionList.map(item => ({
                label: item.name,
                kind: tsKind2CompletionItemKind(item.kind),
            }));
        }
        return [];
    }

    private getCompleteFromComponentNameContent(document: VueTextDocument, position: Position): CompletionItem[] {
        const offset = document.offsetAt(position);
        const node = document.htmlDocument.findNodeAt(offset);
        const { scanner } = getNodeTokens(document, node, offset);
        const content = scanner.getTokenText();
        const match = (/^(\s*)([A-Z][a-zA-Z0-9]*)\s*$/.exec(content)) as RegExpExecArray;
        const space = match[1];
        const name = match[2];
        const tokenOffset = node.start + scanner.getTokenOffset();
        const start = document.positionAt(tokenOffset + space.length);
        const end = document.positionAt(tokenOffset + space.length + name.length);
        return document.vueComponent.components.map(c => ({
            label: c.name,
            kind: CompletionItemKind.Class,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: {
                range: { start, end },
                newText: `<${c.name}>$0</${c.name}>`,
            },
        }));
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
        [ts.ScriptElementKind.jsxAttribute]: CompletionItemKind.Field,
    }[kind];
}

enum VueTokenType {
    /** 组件名称 */
    ComponentName,
    /** 动态属性值 */
    DynamicAttributeValue,
    /** 可能是组件名称的内容 */
    ComponentNameContent,
    /** 其他 */
    Other,
}
