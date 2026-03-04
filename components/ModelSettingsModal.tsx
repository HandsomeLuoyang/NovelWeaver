import React, { useState } from 'react';
import { useStore } from '../store';
import { Icons } from './Icons';
import { AIModel } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const ModelSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const { models, modelConfig, addModel, updateModel, removeModel, updateModelConfig } = useStore();
    const [activeTab, setActiveTab] = useState<'models' | 'assignment' | 'creativity'>('models');

    // Form State
    const [editingModelId, setEditingModelId] = useState<string | null>(null);
    const [formName, setFormName] = useState('');
    const [formKey, setFormKey] = useState('');
    const [formBaseUrl, setFormBaseUrl] = useState('');
    const [formModelName, setFormModelName] = useState('gemini-1.5-flash');

    // Ensure creativityLevel exists with defaults
    const creativityLevel = modelConfig.creativityLevel || {
        genesis: 0.9,
        expansion: 0.8,
        drafting: 0.75,
        polishing: 0.6
    };
    const creativeToolkit = modelConfig.creativeToolkit || {
        antiBlockMode: true,
        divergenceBoost: 0.65,
        twistIntensity: 0.55,
        paceVariance: 0.5,
    };

    if (!isOpen) return null;

    const applyCreativityPreset = (preset: 'balanced' | 'wild' | 'stable' | 'anti-block') => {
        if (preset === 'balanced') {
            updateModelConfig({
                creativityLevel: { genesis: 0.9, expansion: 0.8, drafting: 0.75, polishing: 0.6 },
                creativeToolkit: { antiBlockMode: true, divergenceBoost: 0.65, twistIntensity: 0.55, paceVariance: 0.5 },
                enableCreativitySeeds: true,
                enableQualityCheck: true,
            });
            return;
        }
        if (preset === 'wild') {
            updateModelConfig({
                creativityLevel: { genesis: 1.0, expansion: 0.95, drafting: 0.88, polishing: 0.7 },
                creativeToolkit: { antiBlockMode: true, divergenceBoost: 0.9, twistIntensity: 0.85, paceVariance: 0.75 },
                enableCreativitySeeds: true,
                enableQualityCheck: false,
            });
            return;
        }
        if (preset === 'stable') {
            updateModelConfig({
                creativityLevel: { genesis: 0.75, expansion: 0.65, drafting: 0.58, polishing: 0.45 },
                creativeToolkit: { antiBlockMode: false, divergenceBoost: 0.25, twistIntensity: 0.2, paceVariance: 0.2 },
                enableCreativitySeeds: false,
                enableQualityCheck: true,
            });
            return;
        }
        updateModelConfig({
            creativityLevel: { genesis: 0.92, expansion: 0.85, drafting: 0.8, polishing: 0.62 },
            creativeToolkit: { antiBlockMode: true, divergenceBoost: 0.78, twistIntensity: 0.68, paceVariance: 0.62 },
            enableCreativitySeeds: true,
            enableQualityCheck: true,
        });
    };

    const handleEdit = (m: AIModel) => {
        setEditingModelId(m.id);
        setFormName(m.name);
        setFormKey(m.apiKey);
        setFormBaseUrl(m.baseUrl || '');
        setFormModelName(m.modelName);
    };

    const handleNew = () => {
        setEditingModelId('NEW');
        setFormName('New Gemini Model');
        setFormKey('');
        setFormBaseUrl('');
        setFormModelName('gemini-1.5-flash');
    };

    const handleSaveModel = () => {
        const modelData: AIModel = {
            id: editingModelId === 'NEW' ? uuidv4() : editingModelId!,
            name: formName,
            apiKey: formKey,
            baseUrl: formBaseUrl,
            modelName: formModelName,
            provider: 'google'
        };

        if (editingModelId === 'NEW') {
            addModel(modelData);
        } else {
            updateModel(modelData);
        }
        setEditingModelId(null);
    };

    const handleDelete = (id: string) => {
        if (confirm('确定要删除此模型配置吗？')) {
            removeModel(id);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-card border border-border w-full max-w-3xl h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
                    <h2 className="text-lg font-bold text-foreground flex items-center">
                        <Icons.Bot className="mr-2 w-5 h-5 text-primary" />
                        AI 模型中控台
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
                        <Icons.Close className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border bg-secondary/30">
                    <button
                        onClick={() => setActiveTab('models')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'models' ? 'text-primary border-b-2 border-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        模型库 (Model Registry)
                    </button>
                    <button
                        onClick={() => setActiveTab('assignment')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'assignment' ? 'text-primary border-b-2 border-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        任务分配 (Assignment)
                    </button>
                    <button
                        onClick={() => setActiveTab('creativity')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'creativity' ? 'text-primary border-b-2 border-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        创意控制 (Creativity)
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-background p-6">

                    {/* MODEL REGISTRY TAB */}
                    {activeTab === 'models' && (
                        <div className="space-y-4">
                            {/* List */}
                            {models.map(m => (
                                <div key={m.id} className="bg-secondary/20 border border-border rounded-lg p-4 flex items-center justify-between group hover:border-border/80">
                                    <div>
                                        <div className="font-bold text-foreground flex items-center">
                                            {m.name}
                                            {m.id.startsWith('default') && <span className="ml-2 text-[10px] bg-secondary text-muted-foreground px-1 rounded">System</span>}
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono mt-1">
                                            {m.modelName} • {m.apiKey ? 'API Key Set' : 'Env Key'}
                                        </div>
                                    </div>
                                    {!editingModelId && (
                                        <div className="flex space-x-2 opacity-60 group-hover:opacity-100">
                                            <button onClick={() => handleEdit(m)} className="p-2 hover:bg-secondary rounded text-muted-foreground hover:text-foreground">
                                                <Icons.Edit size={16} />
                                            </button>
                                            {!m.id.startsWith('default') && (
                                                <button onClick={() => handleDelete(m.id)} className="p-2 hover:bg-destructive/10 rounded text-destructive/80 hover:text-destructive">
                                                    <Icons.Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Edit Form */}
                            {editingModelId ? (
                                <div className="bg-card border border-primary/30 rounded-lg p-6 mt-6 animate-in fade-in slide-in-from-bottom-4">
                                    <h3 className="text-sm font-bold text-primary mb-4 uppercase">
                                        {editingModelId === 'NEW' ? '添加新模型' : '编辑模型'}
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="col-span-2">
                                            <label className="text-xs text-muted-foreground block mb-1">配置名称 (Friendly Name)</label>
                                            <input value={formName} onChange={e => setFormName(e.target.value)} className="w-full bg-input border border-border rounded p-2 text-sm focus:border-primary focus:outline-none text-foreground" placeholder="My Gemini Pro" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted-foreground block mb-1">Model Name (e.g. gemini-1.5-flash)</label>
                                            <input value={formModelName} onChange={e => setFormModelName(e.target.value)} className="w-full bg-input border border-border rounded p-2 text-sm focus:border-primary focus:outline-none text-foreground" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted-foreground block mb-1">Base URL (Optional)</label>
                                            <input value={formBaseUrl} onChange={e => setFormBaseUrl(e.target.value)} className="w-full bg-input border border-border rounded p-2 text-sm focus:border-primary focus:outline-none text-foreground" placeholder="https://..." />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="text-xs text-muted-foreground block mb-1">API Key (Leave empty to use .env)</label>
                                            <input type="password" value={formKey} onChange={e => setFormKey(e.target.value)} className="w-full bg-input border border-border rounded p-2 text-sm focus:border-primary focus:outline-none text-foreground" placeholder="sk-..." />
                                        </div>
                                    </div>
                                    <div className="flex justify-end space-x-2 mt-4">
                                        <button onClick={() => setEditingModelId(null)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">取消</button>
                                        <button onClick={handleSaveModel} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90">保存</button>
                                    </div>
                                </div>
                            ) : (
                                <button onClick={handleNew} className="w-full py-3 border border-dashed border-border rounded-lg text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center justify-center">
                                    <Icons.Plus size={16} className="mr-2" />
                                    添加自定义模型
                                </button>
                            )}
                        </div>
                    )}

                    {/* ASSIGNMENT TAB */}
                    {activeTab === 'assignment' && (
                        <div className="space-y-6">
                            <p className="text-sm text-muted-foreground mb-4">为不同的写作阶段分配专门的 AI 模型。例如：用最聪明的模型构思大纲，用速度最快的模型写正文。</p>

                            {([
                                { key: 'genesisModelId', label: '创世引擎 (Genesis)', desc: '负责生成书名、核心梗概、世界观和初始卷。' },
                                { key: 'expansionModelId', label: '结构扩写 (Outlining)', desc: '负责递归拆解章节、细化剧情节点。' },
                                { key: 'draftingModelId', label: '正文撰写 (Drafting)', desc: '负责具体场景的万字正文生成。' },
                                { key: 'polishingModelId', label: '润色编辑 (Polishing)', desc: '负责局部段落的重写和润色。' },
                                { key: 'chatModelId', label: 'AI 助手 (Chat Copilot)', desc: '负责与用户对话、答疑解惑和头脑风暴。' },
                            ] as const).map(item => (
                                <div key={item.key} className="bg-secondary/20 p-4 rounded-lg border border-border">
                                    <label className="text-sm font-bold text-foreground block mb-1">{item.label}</label>
                                    <p className="text-xs text-muted-foreground mb-3">{item.desc}</p>
                                    <select
                                        value={modelConfig[item.key]}
                                        onChange={(e) => updateModelConfig({ [item.key]: e.target.value } as Partial<typeof modelConfig>)}
                                        className="w-full bg-input border border-border text-foreground text-sm rounded p-2 focus:outline-none focus:border-primary"
                                    >
                                        {models.map(m => (
                                            <option key={m.id} value={m.id}>{m.name} ({m.modelName})</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* CREATIVITY TAB */}
                    {activeTab === 'creativity' && (
                        <div className="space-y-6">
                            <p className="text-sm text-muted-foreground mb-4">精细调控 AI 的创意水平和写作行为。创意度越高，AI 越天马行空；越低则越保守稳定。</p>

                            <div className="bg-secondary/20 p-4 rounded-lg border border-border">
                                <h3 className="text-sm font-bold text-foreground mb-3">创意预设</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <button
                                        onClick={() => applyCreativityPreset('balanced')}
                                        className="px-3 py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        平衡默认
                                    </button>
                                    <button
                                        onClick={() => applyCreativityPreset('anti-block')}
                                        className="px-3 py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        防卡文
                                    </button>
                                    <button
                                        onClick={() => applyCreativityPreset('wild')}
                                        className="px-3 py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        放飞灵感
                                    </button>
                                    <button
                                        onClick={() => applyCreativityPreset('stable')}
                                        className="px-3 py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        稳定保守
                                    </button>
                                </div>
                            </div>

                            {/* Creativity Level Sliders */}
                            <div className="bg-secondary/20 p-4 rounded-lg border border-border">
                                <h3 className="text-sm font-bold text-foreground mb-4">创意度控制 (Temperature)</h3>

                                {[
                                    { key: 'genesis', label: '创世引擎', range: '0.8-1.0 高创意' },
                                    { key: 'expansion', label: '结构扩写', range: '0.7-0.9' },
                                    { key: 'drafting', label: '正文撰写', range: '0.6-0.8' },
                                    { key: 'polishing', label: '润色编辑', range: '0.5-0.7' },
                                ].map(item => (
                                    <div key={item.key} className="mb-4 last:mb-0">
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="text-xs font-medium text-foreground">{item.label}</label>
                                            <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-1 rounded">
                                                {creativityLevel[item.key as keyof typeof creativityLevel].toFixed(2)}
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.05"
                                            value={creativityLevel[item.key as keyof typeof creativityLevel]}
                                            onChange={(e) => updateModelConfig({
                                                creativityLevel: {
                                                    ...creativityLevel,
                                                    [item.key]: parseFloat(e.target.value)
                                                }
                                            })}
                                            className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                        <p className="text-[10px] text-muted-foreground mt-1">推荐范围: {item.range}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Feature Toggles */}
                            <div className="bg-secondary/20 p-4 rounded-lg border border-border">
                                <h3 className="text-sm font-bold text-foreground mb-4">高级功能开关</h3>

                                <div className="space-y-3">
                                    {/* Quality Check Toggle */}
                                    <div className="flex items-center justify-between p-3 bg-background/50 rounded border border-border/50">
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-foreground">质量检测 (Quality Check)</div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                启用后，AI 会在生成内容后进行自我检查，修复明显的逻辑错误和不连贯之处。
                                            </p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                checked={modelConfig.enableQualityCheck}
                                                onChange={(e) => updateModelConfig({ enableQualityCheck: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>

                                    {/* Creativity Seeds Toggle */}
                                    <div className="flex items-center justify-between p-3 bg-background/50 rounded border border-border/50">
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-foreground">灵感种子 (Creativity Seeds)</div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                启用后，AI 会在创作过程中注入随机性元素，增强创意多样性和惊喜感。
                                            </p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                checked={modelConfig.enableCreativitySeeds}
                                                onChange={(e) => updateModelConfig({ enableCreativitySeeds: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-secondary/20 p-4 rounded-lg border border-border">
                                <h3 className="text-sm font-bold text-foreground mb-4">防卡文参数</h3>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-background/50 rounded border border-border/50">
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-foreground">卡文急救模式</div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                强制 AI 在生成时附带推进选项、冲突升级和悬念钩子，避免剧情停滞。
                                            </p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                                            <input
                                                type="checkbox"
                                                checked={creativeToolkit.antiBlockMode}
                                                onChange={(e) => updateModelConfig({
                                                    creativeToolkit: {
                                                        ...creativeToolkit,
                                                        antiBlockMode: e.target.checked
                                                    }
                                                })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>

                                    {[
                                        { key: 'divergenceBoost', label: '发散度', desc: '提高备选路径与新奇联想数量' },
                                        { key: 'twistIntensity', label: '反转强度', desc: '提高冲突突变与逆转概率' },
                                        { key: 'paceVariance', label: '节奏波动', desc: '拉开快慢节奏，减少平铺叙事' },
                                    ].map((item) => (
                                        <div key={item.key}>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <label className="text-xs font-medium text-foreground">{item.label}</label>
                                                <span className="text-[11px] text-primary font-mono bg-primary/10 px-2 py-0.5 rounded">
                                                    {Number(creativeToolkit[item.key as keyof typeof creativeToolkit]).toFixed(2)}
                                                </span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max="1"
                                                step="0.05"
                                                value={Number(creativeToolkit[item.key as keyof typeof creativeToolkit])}
                                                onChange={(e) => updateModelConfig({
                                                    creativeToolkit: {
                                                        ...creativeToolkit,
                                                        [item.key]: parseFloat(e.target.value)
                                                    }
                                                })}
                                                className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                                            />
                                            <p className="text-[10px] text-muted-foreground mt-1">{item.desc}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
