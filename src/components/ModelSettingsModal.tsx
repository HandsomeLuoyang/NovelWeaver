import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Icons } from './Icons';
import { AIModel, PromptTaskType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../hooks/useToast';
import { testModelAvailability } from '../services/modelProbe';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const ModelSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const {
        models,
        modelConfig,
        modelProbeLog,
        addModel,
        updateModel,
        removeModel,
        updateModelConfig,
        addModelProbeLogEntry,
        clearModelProbeLog,
    } = useStore();
    const toast = useToast();
    const [activeTab, setActiveTab] = useState<'models' | 'assignment' | 'creativity'>('models');

    // Form State
    const [editingModelId, setEditingModelId] = useState<string | null>(null);
    const [formName, setFormName] = useState('');
    const [formKey, setFormKey] = useState('');
    const [formBaseUrl, setFormBaseUrl] = useState('');
    const [formModelName, setFormModelName] = useState('gemini-1.5-flash');
    const [testingModelId, setTestingModelId] = useState<string | null>(null);
    const [testMessages, setTestMessages] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});
    const [isFormTesting, setIsFormTesting] = useState(false);
    const [formTestMessage, setFormTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [modelFilter, setModelFilter] = useState('');

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
        setFormTestMessage(null);
    };

    const handleNew = () => {
        setEditingModelId('NEW');
        setFormName('新模型');
        setFormKey('');
        setFormBaseUrl('');
        setFormModelName('gemini-1.5-flash');
        setFormTestMessage(null);
    };

    const buildDraftModel = (): AIModel => ({
        id: editingModelId === 'NEW' ? 'NEW' : (editingModelId || 'TEMP'),
        name: formName.trim() || 'Untitled Model',
        apiKey: formKey.trim(),
        baseUrl: formBaseUrl.trim(),
        modelName: formModelName.trim(),
        provider: 'google',
    });

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

    const handleTestExistingModel = async (model: AIModel) => {
        setTestingModelId(model.id);
        setTestMessages((prev) => {
            const next = { ...prev };
            delete next[model.id];
            return next;
        });
        try {
            const result = await testModelAvailability(model);
            const text = `连接成功 · ${result.provider === 'openai' ? 'OpenAI兼容' : 'Gemini'} · ${result.latencyMs}ms`;
            addModelProbeLogEntry({
                id: uuidv4(),
                modelId: model.id,
                modelName: model.name,
                provider: result.provider,
                timestamp: Date.now(),
                success: true,
                latencyMs: result.latencyMs,
            });
            setTestMessages((prev) => ({ ...prev, [model.id]: { type: 'success', text } }));
            toast.success(`模型可用：${model.name}`);
        } catch (error: any) {
            const text = error?.message || '模型测试失败';
            addModelProbeLogEntry({
                id: uuidv4(),
                modelId: model.id,
                modelName: model.name,
                provider: runtimeProvider(model),
                timestamp: Date.now(),
                success: false,
                errorMessage: text,
            });
            setTestMessages((prev) => ({ ...prev, [model.id]: { type: 'error', text } }));
            toast.error(`模型不可用：${text}`);
        } finally {
            setTestingModelId(null);
        }
    };

    const handleTestDraftModel = async () => {
        const model = buildDraftModel();
        setIsFormTesting(true);
        setFormTestMessage(null);
        try {
            const result = await testModelAvailability(model);
            const text = `连接成功 · ${result.provider === 'openai' ? 'OpenAI兼容' : 'Gemini'} · ${result.latencyMs}ms`;
            addModelProbeLogEntry({
                id: uuidv4(),
                modelId: model.id,
                modelName: model.name,
                provider: result.provider,
                timestamp: Date.now(),
                success: true,
                latencyMs: result.latencyMs,
            });
            setFormTestMessage({ type: 'success', text });
            toast.success(`模型可用：${model.modelName}`);
        } catch (error: any) {
            const text = error?.message || '模型测试失败';
            addModelProbeLogEntry({
                id: uuidv4(),
                modelId: model.id,
                modelName: model.name,
                provider: runtimeProvider(model),
                timestamp: Date.now(),
                success: false,
                errorMessage: text,
            });
            setFormTestMessage({ type: 'error', text });
            toast.error(`模型不可用：${text}`);
        } finally {
            setIsFormTesting(false);
        }
    };

    const handleDelete = (id: string) => {
        if (confirm('确定要删除此模型配置吗？')) {
            removeModel(id);
        }
    };

    const modelCount = models.length;
    const runtimeProvider = (model: AIModel) => (
        model.baseUrl && model.baseUrl.trim() ? 'openai' : model.provider
    );

    const tabs: Array<{
        id: 'models' | 'assignment' | 'creativity';
        label: string;
        desc: string;
        Icon: React.ComponentType<{ className?: string }>;
    }> = [
        { id: 'models', label: '模型库', desc: '管理与测试模型', Icon: Icons.Cpu },
        { id: 'assignment', label: '任务分配', desc: '不同阶段指定模型', Icon: Icons.Layout },
        { id: 'creativity', label: '创意控制', desc: '调节风格与发散度', Icon: Icons.Sparkles },
    ];

    const assignmentItems: Array<{
        key: keyof Pick<typeof modelConfig, 'genesisModelId' | 'expansionModelId' | 'draftingModelId' | 'polishingModelId' | 'chatModelId'>;
        taskType: PromptTaskType;
        label: string;
        desc: string;
    }> = [
        { key: 'genesisModelId', taskType: 'genesis', label: '创世引擎', desc: '生成书名、梗概、世界观与初始卷。' },
        { key: 'expansionModelId', taskType: 'expansion', label: '结构扩写', desc: '递归拆解章节、细化剧情节点。' },
        { key: 'draftingModelId', taskType: 'drafting', label: '正文撰写', desc: '基于上下文生成场景正文。' },
        { key: 'polishingModelId', taskType: 'polishing', label: '润色编辑', desc: '选区或整段润色、提升表达。' },
        { key: 'chatModelId', taskType: 'chat', label: 'AI 助手', desc: '对话答疑、头脑风暴。' },
    ];

    const filterKeyword = modelFilter.trim().toLowerCase();
    const filteredModels = filterKeyword
        ? models.filter((model) => {
            const provider = runtimeProvider(model);
            return [
                model.name,
                model.modelName,
                model.baseUrl || '',
                provider === 'openai' ? 'openai兼容' : 'gemini'
            ].join(' ').toLowerCase().includes(filterKeyword);
        })
        : models;

    const modelAssignments = assignmentItems.reduce<Record<string, string[]>>((acc, item) => {
        const assignedModelId = modelConfig[item.key];
        if (!assignedModelId) return acc;
        if (!acc[assignedModelId]) {
            acc[assignedModelId] = [];
        }
        acc[assignedModelId].push(item.label);
        return acc;
    }, {});

    const assignedModelCount = models.filter((model) => (modelAssignments[model.id] || []).length > 0).length;
    const unassignedModelCount = Math.max(0, modelCount - assignedModelCount);
    const probeStats = useMemo(() => models.map((model) => {
        const logs = modelProbeLog.filter((entry) => entry.modelId === model.id);
        const successLogs = logs.filter((entry) => entry.success);
        const avgLatency = successLogs.length > 0
            ? Math.round(successLogs.reduce((sum, entry) => sum + (entry.latencyMs || 0), 0) / successLogs.length)
            : null;
        return {
            modelId: model.id,
            logs,
            successRate: logs.length > 0 ? Math.round((successLogs.length / logs.length) * 100) : null,
            avgLatency,
            last: logs[0] || null,
        };
    }), [models, modelProbeLog]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-6xl h-[88vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col ui-rise-in">
                <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-r from-primary/20 via-primary/5 to-accent/20 pointer-events-none" />

                <div className="relative z-10 px-6 py-5 border-b border-border/70 bg-card/85 backdrop-blur">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-bold text-foreground flex items-center">
                                <Icons.Cpu className="mr-2 w-5 h-5 text-primary" />
                                AI 模型中控台
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                管理模型连接、分配写作任务，并精细调节创意参数。
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <Icons.Close className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="relative z-10 px-6 py-4 border-b border-border/60 bg-background/70">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                        <div className="rounded-xl border border-border bg-card/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">总模型数</p>
                            <p className="mt-1 text-2xl font-semibold text-foreground">{modelCount}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">已分配任务</p>
                            <p className="mt-1 text-2xl font-semibold text-foreground">{assignedModelCount}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">未分配任务</p>
                            <p className="mt-1 text-2xl font-semibold text-foreground">{unassignedModelCount}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`group px-4 py-2 rounded-xl border text-left transition-all ${
                                        isActive
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border bg-card/60 hover:border-primary/40'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                        <tab.Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
                                        {tab.label}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">{tab.desc}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="relative z-10 flex-1 overflow-y-auto bg-background/70 px-6 py-5">
                    {activeTab === 'models' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-foreground">模型库</h3>
                                    <p className="text-sm text-muted-foreground">可在这里新增模型、测试可用性、编辑密钥与端点。</p>
                                </div>
                                <button
                                    onClick={handleNew}
                                    className="inline-flex items-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                                >
                                    <Icons.Plus size={16} className="mr-1.5" />
                                    添加自定义模型
                                </button>
                            </div>

                            <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <Icons.Search size={14} className="text-muted-foreground shrink-0" />
                                    <input
                                        type="text"
                                        value={modelFilter}
                                        onChange={(e) => setModelFilter(e.target.value)}
                                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                                        placeholder="搜索模型名、model name、端点..."
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3">
                                {filteredModels.map((model) => {
                                    const provider = runtimeProvider(model);
                                    const message = testMessages[model.id];
                                    const assignments = modelAssignments[model.id] || [];
                                    const isEditing = editingModelId === model.id;
                                    const stats = probeStats.find((entry) => entry.modelId === model.id);
                                    return (
                                        <div
                                            key={model.id}
                                            className={`rounded-xl border bg-card/70 p-4 transition-colors ${
                                                isEditing ? 'border-primary/50' : 'border-border'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="text-base font-semibold text-foreground">{model.name}</h4>
                                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                                            provider === 'openai'
                                                                ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                                                                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                                        }`}>
                                                            {provider === 'openai' ? 'OpenAI兼容' : 'Gemini'}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 text-xs font-mono text-muted-foreground">{model.modelName}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleTestExistingModel(model)}
                                                        title="测试模型可用性"
                                                        disabled={testingModelId === model.id}
                                                        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
                                                    >
                                                        {testingModelId === model.id
                                                            ? <Icons.Loader2 size={14} className="animate-spin mr-1" />
                                                            : <Icons.Cpu size={14} className="mr-1" />
                                                        }
                                                        测试
                                                    </button>
                                                    <button
                                                        onClick={() => handleEdit(model)}
                                                        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40"
                                                    >
                                                        <Icons.Edit size={14} className="mr-1" />
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(model.id)}
                                                        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10"
                                                    >
                                                        <Icons.Trash2 size={14} className="mr-1" />
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                                    密钥来源：{model.apiKey ? '模型内配置' : '环境变量 (.env)'}
                                                </div>
                                                <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground font-mono truncate">
                                                    端点：{model.baseUrl?.trim() || (provider === 'openai' ? '(默认 OpenAI)' : '(Google 官方)')}
                                                </div>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {assignments.length > 0 ? assignments.map((label) => (
                                                    <span key={label} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                                                        {label}
                                                    </span>
                                                )) : (
                                                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                                                        暂未分配任务
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                                    成功率：{stats?.successRate !== null && stats?.successRate !== undefined ? `${stats.successRate}%` : '暂无'}
                                                </div>
                                                <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                                    平均耗时：{stats?.avgLatency ? `${stats.avgLatency}ms` : '暂无'}
                                                </div>
                                                <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                                    最近状态：{stats?.last ? (stats.last.success ? '可用' : '失败') : '未探测'}
                                                </div>
                                            </div>
                                            {stats?.last && !stats.last.success && stats.last.errorMessage && (
                                                <div className="mt-2 text-[11px] text-red-400">
                                                    最近失败：{stats.last.errorMessage}
                                                </div>
                                            )}
                                            {message && (
                                                <div className={`mt-2 text-xs ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {message.text}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {filteredModels.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
                                        没有匹配的模型，换个关键词试试。
                                    </div>
                                )}
                            </div>

                            <div className="rounded-xl border border-border bg-card/70 p-4">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                        <h4 className="text-sm font-semibold text-foreground">模型可靠性面板</h4>
                                        <p className="text-xs text-muted-foreground mt-1">最近探测记录、失败原因和响应耗时会统一沉淀在这里。</p>
                                    </div>
                                    <button
                                        onClick={clearModelProbeLog}
                                        className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        清空记录
                                    </button>
                                </div>
                                <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                                    {modelProbeLog.length === 0 && (
                                        <div className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-xs text-muted-foreground text-center">
                                            还没有探测记录，先测试一个模型。
                                        </div>
                                    )}
                                    {modelProbeLog.slice(0, 12).map((entry) => (
                                        <div key={entry.id} className="rounded-lg border border-border bg-background/50 px-3 py-2 flex items-center justify-between gap-3 text-xs">
                                            <div className="min-w-0">
                                                <div className="text-foreground font-medium truncate">{entry.modelName}</div>
                                                <div className="text-muted-foreground mt-1 truncate">
                                                    {new Date(entry.timestamp).toLocaleString()} · {entry.provider === 'openai' ? 'OpenAI兼容' : 'Gemini'}
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className={entry.success ? 'text-emerald-400' : 'text-red-400'}>
                                                    {entry.success ? `成功 ${entry.latencyMs || 0}ms` : '失败'}
                                                </div>
                                                {!entry.success && entry.errorMessage && (
                                                    <div className="text-muted-foreground max-w-56 truncate">{entry.errorMessage}</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'assignment' && (
                        <div className="space-y-5">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground">任务分配</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    为每个写作阶段指定模型，形成“构思-扩写-正文-润色”的流水线。
                                </p>
                            </div>
                            {models.length === 0 && (
                                <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
                                    当前没有可用模型，请先到“模型库”添加模型。
                                </div>
                            )}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {assignmentItems.map((item) => {
                                    const currentModel = models.find((model) => model.id === modelConfig[item.key]);
                                    const selectedValue = modelConfig[item.key] || '';
                                    const fallbackValue = modelConfig.fallbackModelIds[item.taskType] || '';
                                    const retryValue = modelConfig.maxRetries[item.taskType] || 1;
                                    return (
                                        <div key={item.key} className="rounded-xl border border-border bg-card/70 p-4">
                                            <label className="text-sm font-semibold text-foreground block">{item.label}</label>
                                            <p className="text-xs text-muted-foreground mt-1 mb-3">{item.desc}</p>
                                            <select
                                                value={selectedValue}
                                                onChange={(e) => updateModelConfig({ [item.key]: e.target.value } as Partial<typeof modelConfig>)}
                                                disabled={models.length === 0}
                                                className="w-full bg-input border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                                            >
                                                {models.length === 0 ? (
                                                    <option value="">请先添加模型</option>
                                                ) : (
                                                    models.map((model) => (
                                                        <option key={model.id} value={model.id}>
                                                            {model.name} ({model.modelName})
                                                        </option>
                                                    ))
                                                )}
                                            </select>
                                            {currentModel && (
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    当前：<span className="text-foreground">{currentModel.name}</span>
                                                </p>
                                            )}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                                <label className="text-xs text-muted-foreground block">
                                                    备用模型
                                                    <select
                                                        value={fallbackValue}
                                                        onChange={(e) => updateModelConfig({
                                                            fallbackModelIds: {
                                                                ...modelConfig.fallbackModelIds,
                                                                [item.taskType]: e.target.value || undefined,
                                                            },
                                                        })}
                                                        className="mt-1 w-full bg-input border border-border text-foreground text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                                                    >
                                                        <option value="">不设置备用</option>
                                                        {models.filter((model) => model.id !== selectedValue).map((model) => (
                                                            <option key={model.id} value={model.id}>
                                                                {model.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="text-xs text-muted-foreground block">
                                                    最大重试次数
                                                    <select
                                                        value={retryValue}
                                                        onChange={(e) => updateModelConfig({
                                                            maxRetries: {
                                                                ...modelConfig.maxRetries,
                                                                [item.taskType]: Number(e.target.value),
                                                            },
                                                        })}
                                                        className="mt-1 w-full bg-input border border-border text-foreground text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                                                    >
                                                        <option value={1}>1 次</option>
                                                        <option value={2}>2 次</option>
                                                        <option value={3}>3 次</option>
                                                    </select>
                                                </label>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {activeTab === 'creativity' && (
                        <div className="space-y-5">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground">创意控制</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    统一调节模型发散程度、质量闸门和防卡文能力。
                                </p>
                            </div>

                            <div className="rounded-xl border border-border bg-card/70 p-4">
                                <h4 className="text-sm font-semibold text-foreground mb-3">创意预设</h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <button
                                        onClick={() => applyCreativityPreset('balanced')}
                                        className="px-3 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        平衡默认
                                    </button>
                                    <button
                                        onClick={() => applyCreativityPreset('anti-block')}
                                        className="px-3 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        防卡文
                                    </button>
                                    <button
                                        onClick={() => applyCreativityPreset('wild')}
                                        className="px-3 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        放飞灵感
                                    </button>
                                    <button
                                        onClick={() => applyCreativityPreset('stable')}
                                        className="px-3 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    >
                                        稳定保守
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-xl border border-border bg-card/70 p-4">
                                <h4 className="text-sm font-semibold text-foreground mb-4">创意度控制（Temperature）</h4>
                                {[
                                    { key: 'genesis', label: '创世引擎', range: '0.8-1.0 高创意' },
                                    { key: 'expansion', label: '结构扩写', range: '0.7-0.9' },
                                    { key: 'drafting', label: '正文撰写', range: '0.6-0.8' },
                                    { key: 'polishing', label: '润色编辑', range: '0.5-0.7' },
                                ].map((item) => (
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
                                        <p className="text-[10px] text-muted-foreground mt-1">推荐范围：{item.range}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-xl border border-border bg-card/70 p-4">
                                <h4 className="text-sm font-semibold text-foreground mb-4">高级功能开关</h4>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-3 bg-background/60 rounded-lg border border-border/70">
                                        <div className="flex-1 pr-3">
                                            <div className="text-sm font-medium text-foreground">质量检测（Quality Check）</div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                生成后自动自检，减少逻辑冲突和内容跳跃。
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

                                    <div className="flex items-center justify-between p-3 bg-background/60 rounded-lg border border-border/70">
                                        <div className="flex-1 pr-3">
                                            <div className="text-sm font-medium text-foreground">灵感种子（Creativity Seeds）</div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                注入受控随机性，提高创意多样性与惊喜感。
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

                            <div className="rounded-xl border border-border bg-card/70 p-4">
                                <h4 className="text-sm font-semibold text-foreground mb-4">防卡文参数</h4>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-background/60 rounded-lg border border-border/70">
                                        <div className="flex-1 pr-3">
                                            <div className="text-sm font-medium text-foreground">卡文急救模式</div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                强制输出推进动作、冲突升级和悬念钩子，避免剧情停滞。
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

                {editingModelId && (
                    <div
                        className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
                        onClick={() => setEditingModelId(null)}
                    >
                        <div
                            className="w-full max-w-2xl rounded-2xl border border-primary/30 bg-card shadow-2xl p-5 space-y-4 ui-rise-in"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <h4 className="text-base font-semibold text-foreground">
                                    {editingModelId === 'NEW' ? '新增模型' : '编辑模型'}
                                </h4>
                                <button
                                    onClick={() => setEditingModelId(null)}
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    title="关闭"
                                >
                                    <Icons.Close size={16} />
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="text-xs text-muted-foreground block mb-1">配置名称</label>
                                    <input
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none text-foreground"
                                        placeholder="例如：我的高速草稿模型"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Model Name</label>
                                    <input
                                        value={formModelName}
                                        onChange={(e) => setFormModelName(e.target.value)}
                                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none text-foreground font-mono"
                                        placeholder="gemini-1.5-flash"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Base URL（可选）</label>
                                    <input
                                        value={formBaseUrl}
                                        onChange={(e) => setFormBaseUrl(e.target.value)}
                                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none text-foreground font-mono"
                                        placeholder="https://api.example.com/v1"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-xs text-muted-foreground block mb-1">API Key（留空则读 .env）</label>
                                    <input
                                        type="password"
                                        value={formKey}
                                        onChange={(e) => setFormKey(e.target.value)}
                                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none text-foreground"
                                        placeholder="sk-..."
                                    />
                                </div>
                            </div>

                            {formTestMessage && (
                                <div className={`text-xs ${formTestMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {formTestMessage.text}
                                </div>
                            )}

                            <div className="flex flex-wrap justify-end gap-2">
                                <button
                                    onClick={handleTestDraftModel}
                                    disabled={isFormTesting}
                                    className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                                >
                                    {isFormTesting
                                        ? <><Icons.Loader2 size={14} className="animate-spin mr-1" /> 测试中</>
                                        : <>测试模型</>
                                    }
                                </button>
                                <button
                                    onClick={() => setEditingModelId(null)}
                                    className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleSaveModel}
                                    className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                                >
                                    保存模型
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
