"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const mocha_1 = require("mocha");
(0, mocha_1.suite)('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    (0, mocha_1.test)('Split Editor Right Limited Command', () => __awaiter(void 0, void 0, void 0, function* () {
        // Activate the extension
        yield vscode.commands.executeCommand('extension.splitEditorRightLimited');
        // Get the active editor group
        const activeGroup = vscode.window.tabGroups.activeTabGroup;
        // Check if the command executed correctly
        if (vscode.window.tabGroups.all.length < 2) {
            assert.strictEqual(vscode.window.tabGroups.all.length, 2, 'Should have split the editor into two groups');
        }
        else if (activeGroup.viewColumn === vscode.ViewColumn.Two) {
            assert.strictEqual(activeGroup.viewColumn, vscode.ViewColumn.One, 'Should have moved the editor to the first group');
        }
        else {
            assert.fail('Unexpected state');
        }
    }));
});
