import * as ts from "typescript";
import { ASTElement, ASTExpression, compile } from "vue-template-compiler";
import { getLanguageService, Node, TextDocument } from "vscode-html-languageservice";
import VueTextDocuments, { VueTextDocument } from './documents';
import { VueComponent, parseComponent } from './parse';
import { PositionManager } from './position';

const htmlLanguageService = getLanguageService();

const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
};

export const getServicesHost = (documents: VueTextDocuments):ts.LanguageServiceHost => {
    return {
        getScriptFileNames: () => {
            return documents.all().map(getFileName);
        },
        getScriptVersion: fileName => {
            return String(documents.get(getUri(fileName))?.version);
        },
        getScriptSnapshot: fileName => {
            const document = documents.get(fileName.slice(0, fileName.length - 3));
            if (!document) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(getScriptString(document));
        },
        getCurrentDirectory: () => "/",
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: ts.getDefaultLibFileName,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
    };
};

/** 获取文件名 */
export function getFileName(document: TextDocument) {
    if (document.uri.endsWith(".vue")) {
        return document.uri + ".ts";
    }
    return document.uri;
}

/** 获取文件 uri */
export function getUri(fileName: string) {
    if (fileName.endsWith(".vue.ts")) {
        return fileName.slice(0, fileName.length - 3);
    }
    return fileName;
}

/** 获取 vue 文件中的 ts 部分，将 template 中的表达式依次加入 render 方法中 */
function getScriptString(document: VueTextDocument) {
    document.htmlDocument = htmlLanguageService.parseHTMLDocument(document);
    const template = document.htmlDocument.roots.find(root => root.tag === "template");
    const script = document.htmlDocument.roots.find(root => root.tag === "script");
    if (template && script) {
        let content = document.getText().slice(script.startTagEnd || script.start, script.endTagStart || script.end);
        const ast = ts.createSourceFile("source.ts", content, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
        // 找到组件类
        const component = ast.statements.find(statement => statement.kind === ts.SyntaxKind.ClassDeclaration);
        if (component && ts.isClassDeclaration(component)) {
            const express = getExpress(document, template);
            /** render 函数插入的位置，以 ts 开始位置为基准 */
            const pos = component.members[component.members.length - 1].end;
            document.vueComponent = parseComponent(component);
            document.renderStart = pos;
            const { render, position } = getRenderString(document.vueComponent, document.renderStart, express);
            document.position = position;
            // 增加 render 函数
            content = content.slice(0, pos) + render + content.slice(pos);
        }
        return content;
    }
    return "";
}

/**
 * 获取 render 函数字符串和位置
 * @param vueComponent 当前组件
 * @param renderStart render 函数开始位置，以ts开始位置为基准
 * @param express 表达式列表
 * @returns render 函数相关信息
 */
function getRenderString(vueComponent: VueComponent, renderStart: number, express: Record<number, string>) {
    const header = "render(){";
    const footer = "}";
    const getPropertyName = (property: ts.PropertyDeclaration | ts.GetAccessorDeclaration | ts.MethodDeclaration) => {
        const name = property.name;
        if (ts.isIdentifier(name)) {
            return name.escapedText;
        }
        return "";
    };
    const propertyList = [
        ...(vueComponent.model ? [vueComponent.model] : []),
        ...vueComponent.props,
        ...vueComponent.computedProps,
        ...vueComponent.datas,
        ...vueComponent.methods
    ];
    const predefine = `const {${[propertyList.map(getPropertyName)].join(',')}} = this;`;
    const kvList = Object.entries(express).sort((a, b) => Number(a[0]) - Number(b[0]));
    const expressList = kvList.map(item => item[1]);
    const source = kvList.map(item => Number(item[0]));
    const target: number[] = [];
    let total = renderStart + header.length + predefine.length;
    for (let i = 0; i < source.length; i++) {
        target.push(total);
        total += expressList[i].length + 1;
    }
    const render = [
        header,
        predefine,
        expressList.join(";"),
        footer,
    ].join("");
    const position = new PositionManager(source, target);
    return {
        render,
        position
    };
}

/** 获取模版中的表达式 */
function getExpress(document: TextDocument, template: Node) {
    const text = document.getText();
    const express: Record<number, string> = {};
    // 编译 ast
    const content = text.slice(template.start, template.end);
    // template 与 ast 中的 AstElement 元素一一对应
    const ast = compile(content).ast;
    if (ast) {
        // 收集模版中所有表达式，并保存表达式的位置
        collectExpress(document, ast, template).forEach(({ start, value }) => {
            start = start + template.start;
            express[start] = value;
        });
    }
    return express;
}

/** 收集元素中的所有表达式 */
function collectExpress(document: TextDocument, element: ASTElement, node: Node): Expression[] {
    const express: Expression[] = [];
    // 处理 ASTElement, 收集属性值中的表达式
    element.attrsList.filter(({ name }) => name[0] === ':').forEach(({ name, value }) => {
        const text = document.getText({
            start: document.positionAt(node.start),
            end: document.positionAt(node.startTagEnd || node.end)}
        );
        const attr = `${name}="${value}"`;
        const start = (text.indexOf(attr) + name.length + 2 + node.start);
        express.push({ start: start, value });
    });
    (element.children.filter(child => child.type === 1) as ASTElement[]).forEach((child, index) => {
        express.push(...collectExpress(document, child, node.children[index]));
    });
    // 处理 ASTExpression, 收集双大括号中的表达式
    (element.children.filter(child => child.type === 2) as ASTExpression[]).forEach(child => {
        const text = child.text;
        let index = 0;
        child.tokens.forEach(token => {
            if (typeof token === 'string') {
                index += token.length;
            } else {
                const value = token["@binding"];
                if (value) {
                    index = text.indexOf(value, index);
                    const start = index + (node.startTagEnd || node.start);
                    express.push({
                        start: start,
                        value
                    });
                    index += value.length;
                }
            }
        });
    });
    return express;
}

/** 模版中的表达式 */
interface Expression {
    start: number;
    value: string;
}
