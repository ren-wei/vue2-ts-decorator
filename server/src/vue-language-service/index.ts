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

/** 解析 Vue 组件，获取 vue 组成部分 */
function parseComponent(component: ts.ClassDeclaration | undefined) {
    // 收集组件 model, props, data, computed 和 method
    let model = null as ts.PropertyDeclaration | null;
    const props: ts.PropertyDeclaration[] = [];
    const computedProps: ts.GetAccessorDeclaration[] = [];
    const datas: ts.PropertyDeclaration[] = [];
    const methods: ts.MethodDeclaration[] = [];
    if (component) {
        component.members.forEach(member => {
            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                const property = member as ts.PropertyDeclaration;
                // 带有装饰器的属性是 model 或 props
                const decorators = (property.modifiers || []).filter(modifier => modifier.kind === ts.SyntaxKind.Decorator) as ts.Decorator[];
                if (decorators.length) {
                    decorators.forEach(decorator => {
                        if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                            const callExpression = decorator.expression as ts.CallExpression;
                            if (callExpression.expression.kind === ts.SyntaxKind.Identifier) {
                                const identifier = callExpression.expression as ts.Identifier;
                                if (identifier.escapedText === "Model") {
                                    model = property;
                                } else if (identifier.escapedText === "Prop") {
                                    props.push(property);
                                }
                            }
                        }
                    });
                } else {
                    datas.push(property);
                }
            } else if (member.kind === ts.SyntaxKind.GetAccessor) {
                computedProps.push(member as ts.GetAccessorDeclaration);
            } else if (member.kind === ts.SyntaxKind.MethodDeclaration) {
                methods.push(member as ts.MethodDeclaration);
            }
        });
    }
    return { model, props, computedProps, datas, methods };
}