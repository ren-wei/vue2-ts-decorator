import * as ts from "typescript";
import { Node, TokenType } from "vscode-html-languageservice";
import { VueTextDocument } from './documents';
import { htmlLanguageService } from './host';

/** 解析 Vue 组件，获取 vue 组成部分 */
export function parseComponent(sourceFile: ts.SourceFile): VueComponent {
    // 找到组件类
    const component = sourceFile.statements.find(statement => ts.isClassDeclaration(statement)) as ts.ClassDeclaration;
    // 收集组件 name, jsDocComment, model, props, data, computed 和 method
    let name = "default";
    let jsDocComment: string[] = [];
    let model = null as ts.PropertyDeclaration | null;
    const props: ts.PropertyDeclaration[] = [];
    const computedProps: ts.GetAccessorDeclaration[] = [];
    const datas: ts.PropertyDeclaration[] = [];
    const methods: ts.MethodDeclaration[] = [];
    if (component) {
        if (component.name) {
            name = component.name.escapedText.toString();
        }
        const jsDoc = (component as ts.ClassDeclaration & { jsDoc?: ts.JSDoc[] }).jsDoc;
        if (jsDoc) {
            jsDocComment = jsDoc.map(v => typeof v.comment === "string" ? v.comment : "");
        }
        component.members.forEach(member => {
            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                const property = member as ts.PropertyDeclaration;
                // 带有装饰器的属性是 model 或 props
                const decorators = (property.modifiers || [])
                    .filter(modifier => ts.isDecorator(modifier)) as ts.Decorator[];
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
    // 收集注册的组件
    const importComponents: RegisteredVueComponent[] = [];
    sourceFile.statements
        .forEach(s => {
            if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
                if (s.moduleSpecifier.text.endsWith(".vue")) {
                    importComponents.push({
                        name: s.importClause?.name?.escapedText.toString() || "",
                        path: s.moduleSpecifier.text
                    });
                }
            }
        });
    const decorator = component.modifiers?.find(m => ts.isDecorator(m)) as ts.Decorator;
    const components: RegisteredVueComponent[] = [];
    if (decorator) {
        if (ts.isCallExpression(decorator.expression)) {
            const identifier = decorator.expression.expression;
            if (ts.isIdentifier(identifier) && identifier.escapedText.toString() === "Component") {
                const objectLiteral = decorator.expression.arguments[0];
                if (ts.isObjectLiteralExpression(objectLiteral)) {
                    const componentsProperty = objectLiteral.properties.find(p => {
                        if (p.name && ts.isIdentifier(p.name)) {
                            return  p.name.escapedText.toString() === "components";
                        }
                        return false;
                    });
                    if (componentsProperty && ts.isPropertyAssignment(componentsProperty)) {
                        if (ts.isObjectLiteralExpression(componentsProperty.initializer)) {
                            componentsProperty.initializer.properties.forEach(p => {
                                if (ts.isShorthandPropertyAssignment(p)) {
                                    const name = p.name.escapedText.toString();
                                    const path = importComponents.find(v => v.name === name)?.path;
                                    if (path) {
                                        components.push({ name, path });
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }
    }
    return { name, jsDocComment, model, props, computedProps, datas, methods, components };
}

/** 解析 html 节点，获取 token 和当前所在的 token 的 scanner */
export function getNodeTokens(document: VueTextDocument, node: Node, offset: number) {
    const content = document.getText().slice(node.start, node.end);
    const scanner = htmlLanguageService.createScanner(content);
    const tokens: string[] = [];
    let token = scanner.scan();
    while(token !== TokenType.EOS) {
        tokens.push(scanner.getTokenText());
        if (scanner.getTokenOffset() + scanner.getTokenLength() > offset - node.start) {
            break;
        }
        token = scanner.scan();
    }
    return { scanner, tokens };
}

/** 组件基本信息 */
export interface VueComponent {
    name: string;
    jsDocComment: string[];
	model: ts.PropertyDeclaration | null;
    props: ts.PropertyDeclaration[];
    computedProps: ts.GetAccessorDeclaration[];
    datas: ts.PropertyDeclaration[];
    methods: ts.MethodDeclaration[];
    components: RegisteredVueComponent[];
}

/** 注册的组件 */
export interface RegisteredVueComponent {
    name: string;
    path: string;
}
