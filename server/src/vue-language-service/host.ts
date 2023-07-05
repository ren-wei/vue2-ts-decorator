import * as ts from "typescript";
import { ASTElement, ASTExpression, compile, compileToFunctions } from "vue-template-compiler";
import { getLanguageService, Node, Range, TextDocument } from "vscode-html-languageservice";
import VueTextDocuments, { VueTextDocument } from './documents';

const htmlLanguageService = getLanguageService();

const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
};

export const documentExpressRangeMap = new Map<string, (start: number, length: number) => Range[]>();

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
    const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
    const template = htmlDocument.roots.find(root => root.tag === "template");
    const script = htmlDocument.roots.find(root => root.tag === "script");
    /** 表达式到表达式的范围的映射 */
    if (template && script) {
        const expressRangeMap = getExpressRangeMap(document, template);

        let content = document.getText().slice(script.startTagEnd || script.start, script.endTagStart || script.end);
        const ast = ts.createSourceFile("source.ts", content, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
        // 找到组件类
        const component = ast.statements.find(statement => statement.kind === ts.SyntaxKind.ClassDeclaration);
        if (component && ts.isClassDeclaration(component)) {
            /** render 函数插入的位置 */
            const pos = component.members[component.members.length - 1].end;
            const renderHeader = "render(){";
            const expressList = [...expressRangeMap.keys()].map(compileExpress);
            const render = [ renderHeader, expressList.map(v => v.statement).join(";"), "}"].join("");
            const offset = pos + renderHeader.length; // render 函数体开始的位置
            /** 根据诊断的开始位置获取表达式在实际模版中的位置 */
            const getExpressRange = (start: number, length: number) => {
                // start 是从基于 ts 内开始的位置
                let index = 0; // 当前表达式列表的索引，依次增加
                let current = offset; // 当前位置
                // 忽略函数体之前的诊断
                if (start < current) {
                    return [];
                }
                // 遍历表达式列表，找到实际的位置
                while(index < expressList.length) {
                    const prev = current; // 上次的位置
                    current += expressList[index].statement.length + 1; // 1 是分号
                    if (current > start) {
                        const rangeList = expressRangeMap.get(expressList[index].express) || [];
                        const startOffset = getExpressPosition(expressList[index].mapping, start - prev);
                        return rangeList.map(range => ({
                            start: document.positionAt(range.start + startOffset),
                            end: document.positionAt(range.start + startOffset + length)
                        }));
                    }
                    index++;
                }
                return [];
            };
            documentExpressRangeMap.set(document.uri, getExpressRange);
            // 增加 render 函数
            content = content.slice(0, pos) + render + content.slice(pos);
        }
        return content;
    }
    return "";
}

/** 获取模版中的表达式的位置映射 */
function getExpressRangeMap(document: TextDocument, template: Node) {
    const text = document.getText();
    const expressRangeMap = new Map<string, { start: number, end: number }[]>();
    // 编译 ast
    const content = text.slice(template.start, template.end);
    // template 与 ast 中的 AstElement 元素一一对应
    const ast = compile(content).ast;
    if (ast) {
        // 收集模版中所有表达式，并保存表达式的位置
        collectExpress(document, ast, template).forEach(({ start, end, value }) => {
            start = start + template.start;
            end = (end) + template.start;
            if (expressRangeMap.has(value)) {
                expressRangeMap.get(value)?.push({ start, end });
            } else {
                expressRangeMap.set(value, [{ start, end }]);
            }
        });
    }
    return expressRangeMap;
}

/** 收集元素中的所有表达式 */
function collectExpress(document: TextDocument, element: ASTElement, node: Node): Expression[] {
    const express: Expression[] = [];
    // 处理 ASTElement, 收集属性值中的表达式
    element.attrsList.filter(({ name }) => name[0] === ':').forEach(({ name, value }) => {
        const text = document.getText({ start: document.positionAt(node.start), end: document.positionAt(node.startTagEnd || node.end)});
        const attr = `${name}="${value}"`;
        const start = (text.indexOf(attr) + name.length + 2 + node.start);
        const end = (start + value.length);
        express.push({ start: start, end: end, value });
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
                    const end = start + value.length;
                    express.push({
                        start: start,
                        end: end,
                        value
                    });
                    index += value.length;
                }
            }
        });
    });
    return express;
}

/**
 * 编译模版中的表达式，返回编译后的表达式和源映射
 * @param express 表达式字符串
 * @returns express 表达式
 * @returns mapping 映射关系 `${curPos},${curEnd};${pos},${end}`
 */
function compileExpress(express: string): CompileExpressResult {
    const ast = ts.createSourceFile("source.ts", express, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const getIdentifiers = (node: ts.Node): ts.Identifier[] => {
        if (ts.isIdentifier(node)) {
            return [node];
        }
        if (ts.isExpressionStatement(node) || ts.isPropertyAccessExpression(node)) {
            return getIdentifiers(node.expression);
        }
        if (ts.isBinaryExpression(node)) {
            return [...getIdentifiers(node.left), ...getIdentifiers(node.right)];
        }
        return [];
    };
    let statement = "";
    let preEnd = 0;
    // 标识符前面加上 this
    const identifiers = (ast.statements.map(statement => getIdentifiers(statement)).flat());
    const mapping: string[] = [];
    for (let i = 0; i < identifiers.length; i++) {
        const { end, escapedText } = identifiers[i];
        const pos = end - escapedText.toString().length;
        const front = express.slice(preEnd ? preEnd : pos, pos);
        const curPos = statement.length + front.length + 5;
        const curEnd = curPos + end - pos;
        mapping.push(`${curPos},${curEnd};${pos},${end}`);
        statement += `${front}this.${express.slice(pos, end)}`;
        preEnd = end;
    }
    if (preEnd < express.length) {
        statement += express.slice(preEnd);
    }
    // console.log("express:  ", express);
    // console.log("statement:", statement);
    // console.log("mapping:", mapping);
    return { express, statement, mapping };
}

/** 根据映射获取实际位置 */
function getExpressPosition(mapping: string[], pos: number) {
    for (let i = 0; i < mapping.length; i++) {
        const [cur, prev] = mapping[i].split(";");
        const [curPos, curEnd] = cur.split(",").map(Number);
        const [prevPos, prevEnd] = prev.split(",").map(Number);
        if (pos < curEnd || i === mapping.length - 1) {
            return prevPos + pos - curPos;
        }
    }
    return pos;
}

interface CompileExpressResult {
    express: string;
    statement: string;
    mapping: string[];
}

/** 模版中的表达式 */
interface Expression {
    start: number;
    end: number;
    value: string;
}
