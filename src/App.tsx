/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  Square, 
  Network, 
  MessageSquare, 
  Lightbulb, 
  BookOpen, 
  ChevronRight,
  RefreshCw,
  Activity,
  User,
  Clock,
  LayoutDashboard,
  FileDown,
  Radio,
  Wifi,
  AlertCircle
} from 'lucide-react';
import { useTranscription, TranscriptSegment } from './hooks/useTranscription';
import { analyzeConversation, getTermDefinition, ConversationNode, InsightData } from './services/aiService';
import { LatestOnlyQueue } from './services/networkQueue';
import {
  NetworkMode,
  TranscriptionMode,
  TranscriptionSettings,
} from './services/transcriptionProviders/types';
import html2pdf from 'html2pdf.js';

import { 
  Group, 
  Panel, 
  Separator 
} from 'react-resizable-panels';

// --- Components ---

const Header = ({
  settings,
  onSettingsChange,
  transcriptionStatusLabel,
  analysisStatusLabel,
  isRecording,
}: {
  settings: TranscriptionSettings;
  onSettingsChange: (next: Partial<TranscriptionSettings>) => void;
  transcriptionStatusLabel: string;
  analysisStatusLabel: string;
  isRecording: boolean;
}) => (
  <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6 sticky top-0 z-50">
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
        <Network size={20} />
      </div>
      <h1 className="font-bold text-xl tracking-tight text-gray-900">EchoMap</h1>
      <span className="text-xs font-medium px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100 ml-2">BETA</span>
    </div>
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <Radio size={13} />
        <select
          value={settings.transcriptionMode}
          disabled={isRecording}
          onChange={(e) => onSettingsChange({ transcriptionMode: e.target.value as TranscriptionMode })}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-400 disabled:opacity-50"
        >
          <option value="standard">標準認識</option>
          <option value="high-accuracy">高精度AI認識</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <Wifi size={13} />
        <select
          value={settings.networkMode}
          disabled={isRecording}
          onChange={(e) => onSettingsChange({ networkMode: e.target.value as NetworkMode })}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-400 disabled:opacity-50"
        >
          <option value="balanced">通信バランス</option>
          <option value="low-bandwidth">省通信</option>
        </select>
      </label>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Activity size={14} className="text-green-500 animate-pulse" />
        <span>{transcriptionStatusLabel} / {analysisStatusLabel}</span>
      </div>
      <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600">
        <User size={18} />
      </div>
    </div>
  </header>
);

import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  Node, 
  Edge, 
  Handle, 
  Position,
  useNodesState,
  useEdgesState,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

const getSegmentSummaryLabel = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '要点';
  const firstChunk = normalized.split(/[。！？!?、,]/)[0]?.trim() || normalized;
  return firstChunk.length > 14 ? `${firstChunk.slice(0, 14)}…` : firstChunk;
};

const getSegmentDisplayLabel = (
  seg: TranscriptSegment,
  conversationNodes: ConversationNode[]
) => {
  const linkedNodes = conversationNodes.filter(
    (node) => node.sourceSegmentIds?.includes(seg.id) && node.shortLabel
  );
  if (linkedNodes.length > 0) {
    // Prefer more concrete labels over broad summary labels.
    const sorted = [...linkedNodes].sort((a, b) => {
      if (a.type === 'summary' && b.type !== 'summary') return 1;
      if (a.type !== 'summary' && b.type === 'summary') return -1;
      return (a.shortLabel?.length || 99) - (b.shortLabel?.length || 99);
    });
    return sorted[0].shortLabel;
  }
  return getSegmentSummaryLabel(seg.text);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizePdfFilename = (value: string, fallback: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const baseName = cleaned || fallback;
  return baseName.toLowerCase().endsWith('.pdf') ? baseName : `${baseName}.pdf`;
};

// --- Custom Node Component ---

const LogicNode = ({ data }: { data: any }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const typeLabels: Record<string, string> = {
    topic: '話題',
    reason: '理由',
    example: '具体例',
    supplement: '補足',
    summary: '統合要約'
  };

  const colorClass = 
    data.type === 'topic' ? 'border-blue-500 bg-blue-50 text-blue-900' : 
    data.type === 'reason' ? 'border-orange-400 bg-orange-50 text-orange-900' : 
    data.type === 'example' ? 'border-green-400 bg-green-50 text-green-900' : 
    data.type === 'summary' ? 'border-red-500 bg-red-50 text-red-900' :
    'border-slate-400 bg-slate-50 text-slate-900';

  const isSelected = data.selectedNodeId === data.id;

  return (
    <div 
      className={`px-4 py-2 shadow-lg rounded-xl border-2 transition-all duration-300 cursor-pointer relative ${colorClass} ${isExpanded ? 'w-[320px]' : 'w-[180px]'} ${data.isNew ? 'ring-4 ring-yellow-400 ring-offset-2' : ''} ${isSelected ? 'ring-4 ring-blue-400 scale-105 z-30' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        setIsExpanded(!isExpanded);
        data.onNodeSelect(data.id);
      }}
    >
      {data.isNew && (
        <div className="absolute -top-3 -right-3 bg-yellow-400 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm z-20">
          NEW
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-300" />
      <div className="flex items-center justify-between mb-1">
        <div className="text-[9px] font-bold uppercase tracking-wider opacity-60">
          {typeLabels[data.type] || data.type}
        </div>
        <div className="text-[9px] bg-white/50 px-1 rounded border border-black/5">
          {isExpanded ? '閉じる' : '詳細'}
        </div>
      </div>
      <div className={`text-sm font-medium leading-tight ${isExpanded ? '' : 'truncate'}`}>
        {isExpanded ? data.text : (data.shortLabel || data.text)}
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-300" />
    </div>
  );
};

const nodeTypes = {
  logic: LogicNode,
};

const LogicalMap = ({ 
  conversationNodes, 
  selectedNodeId, 
  onNodeSelect, 
  isAnalyzing,
  onRefresh
}: { 
  conversationNodes: ConversationNode[], 
  selectedNodeId: string | null, 
  onNodeSelect: (id: string) => void, 
  isAnalyzing: boolean,
  onRefresh: () => void
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const prevNodesCount = useRef(0);

  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    const rootTopics = conversationNodes.filter(n => !n.parentId);
    
    // Horizontal subtree height calculation
    const getSubtreeHeight = (nodeId: string): number => {
      const children = conversationNodes.filter(n => n.parentId === nodeId);
      if (children.length === 0) return 100; // Base height for a single node
      return children.reduce((sum, child) => sum + getSubtreeHeight(child.id), 0);
    };

    const layoutNode = (nodeId: string, depth: number, yStart: number, totalHeight: number) => {
      const node = conversationNodes.find(n => n.id === nodeId);
      if (!node) return;

      const x = depth * 280;
      const y = yStart + totalHeight / 2 - 40;

      // Check if this node is "new" (added in the last update)
      const isNew = conversationNodes.indexOf(node) >= prevNodesCount.current;

      newNodes.push({
        id: node.id,
        type: 'logic',
        data: { 
          id: node.id,
          text: node.text, 
          shortLabel: node.shortLabel, 
          type: node.type, 
          isNew,
          selectedNodeId,
          onNodeSelect
        },
        position: { x, y },
        draggable: true,
      });

      const children = conversationNodes.filter(n => n.parentId === nodeId);
      let currentY = yStart;
      children.forEach((child) => {
        const childHeight = getSubtreeHeight(child.id);
        
        newEdges.push({
          id: `e-${nodeId}-${child.id}`,
          source: nodeId,
          target: child.id,
          animated: true,
          style: { stroke: '#94A3B8', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8' },
        });

        layoutNode(child.id, depth + 1, currentY, childHeight);
        currentY += childHeight;
      });
    };

    let currentRootY = 0;
    rootTopics.forEach((root) => {
      const rootHeight = getSubtreeHeight(root.id);
      layoutNode(root.id, 0, currentRootY, rootHeight);
      currentRootY += rootHeight + 100;
    });

    setNodes(newNodes);
    setEdges(newEdges);
    prevNodesCount.current = conversationNodes.length;
  }, [conversationNodes, selectedNodeId, onNodeSelect]);

  return (
    <div className="h-full w-full bg-gray-50 relative" onClick={() => onNodeSelect('')}>
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-white/80 backdrop-blur p-2 px-3 rounded-lg border border-gray-200 shadow-sm">
        <Network size={18} className="text-blue-600" />
        <h2 className="font-semibold text-gray-700 text-sm">論理構造マップ</h2>
        {isAnalyzing && (
          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-200">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
            <span className="text-[10px] font-bold text-blue-600 animate-pulse">更新中...</span>
          </div>
        )}
        <button 
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          disabled={isAnalyzing}
          className="ml-2 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all disabled:opacity-30"
          title="強制的にマップを更新"
        >
          <RefreshCw size={14} className={isAnalyzing ? 'animate-spin' : ''} />
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="bg-dots-gray-200"
      >
        <Background color="#E5E7EB" gap={20} />
        <Controls />
        <MiniMap nodeStrokeWidth={3} zoomable pannable />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 opacity-40 pointer-events-none">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
            <Network size={24} />
          </div>
          <p className="text-sm">録音を開始すると、マインドマップが生成されます</p>
        </div>
      )}
    </div>
  );
};

const MainStream = ({ 
  transcript, 
  interimText, 
  summary, 
  isRecording, 
  onToggleRecording,
  onExportPdf,
  selectedNodeId,
  conversationNodes,
  keyTerms,
  errorMessage,
}: { 
  transcript: TranscriptSegment[], 
  interimText: string,
  summary: string,
  isRecording: boolean,
  onToggleRecording: () => void,
  onExportPdf: () => void,
  selectedNodeId: string | null,
  conversationNodes: ConversationNode[],
  keyTerms: { term: string }[],
  errorMessage?: string | null,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If user is within 50px of bottom, enable auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShouldAutoScroll(isAtBottom);
  };

  useEffect(() => {
    if (scrollRef.current && shouldAutoScroll) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, interimText, shouldAutoScroll]);

  useEffect(() => {
    if (!isRecording) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const elapsedLabel = [
    Math.floor(elapsedSeconds / 3600),
    Math.floor((elapsedSeconds % 3600) / 60),
    elapsedSeconds % 60,
  ]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');

  // Find which nodes a segment belongs to and highlight snippets + key terms
  const renderHighlightedText = (seg: TranscriptSegment) => {
    const nodes = conversationNodes.filter(n => n.sourceSegmentIds?.includes(seg.id));
    
    let text = seg.text;
    const colors: Record<string, string> = {
      topic: 'decoration-blue-400',
      reason: 'decoration-orange-400',
      example: 'decoration-green-400',
      summary: 'decoration-red-400',
      supplement: 'decoration-slate-400'
    };

    let parts: (string | React.ReactNode)[] = [text];

    // 1. Highlight Logic Nodes (Snippets)
    const snippets = nodes
      .filter(n => n.sourceTextSnippet)
      .sort((a, b) => (b.sourceTextSnippet?.length || 0) - (a.sourceTextSnippet?.length || 0));

    snippets.forEach(node => {
      const snippet = node.sourceTextSnippet!;
      const isSelected = selectedNodeId === node.id;
      
      parts = parts.flatMap(part => {
        if (typeof part !== 'string') return part;
        const index = part.indexOf(snippet);
        if (index === -1) return part;

        return [
          part.substring(0, index),
          <span 
            key={`node-${node.id}-${index}`}
            className={`underline decoration-2 underline-offset-4 transition-all duration-300 ${colors[node.type]} ${isSelected ? 'bg-yellow-100 font-bold' : ''}`}
          >
            {snippet}
          </span>,
          part.substring(index + snippet.length)
        ];
      });
    });

    // 2. Highlight Key Terms (Pink)
    keyTerms.forEach((termObj, termIdx) => {
      const term = termObj.term;
      parts = parts.flatMap(part => {
        if (typeof part !== 'string') return part;
        const index = part.indexOf(term);
        if (index === -1) return part;

        return [
          part.substring(0, index),
          <span 
            key={`term-${termIdx}-${index}`}
            className="underline decoration-2 underline-offset-4 decoration-pink-400 bg-pink-50/50 font-medium"
          >
            {term}
          </span>,
          part.substring(index + term.length)
        ];
      });
    });

    return <p className="text-gray-700 leading-relaxed">{parts}</p>;
  };

  return (
    <div className="h-full flex flex-col bg-white border-x border-gray-200">
      {/* Summary Area */}
      <div className="p-4 border-b border-gray-100 bg-blue-50/30">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb size={16} className="text-blue-600" />
          <span className="text-xs font-bold text-blue-800 uppercase tracking-widest">Live Summary</span>
        </div>
        <div className="min-h-[60px] flex items-center">
          {summary ? (
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-gray-700 leading-relaxed font-medium"
            >
              {summary}
            </motion.p>
          ) : (
            <p className="text-sm text-gray-400 italic">
              {isRecording ? "会話を分析中..." : "録音を開始すると要約が表示されます"}
            </p>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Transcript Area */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar"
      >
        {transcript.map((seg) => {
          const isSelected = conversationNodes.some(n => n.id === selectedNodeId && n.sourceSegmentIds?.includes(seg.id));
          const summaryLabel = getSegmentDisplayLabel(seg, conversationNodes);
          return (
            <motion.div 
              key={seg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 p-2 rounded-xl transition-all duration-300 ${isSelected ? 'ring-2 ring-blue-400 bg-blue-50/30 shadow-md scale-[1.02]' : ''}`}
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold border border-gray-200">
                {summaryLabel[0]}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm text-gray-900">{summaryLabel}</span>
                  <span className="text-[10px] text-gray-400">{new Date(seg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {renderHighlightedText(seg)}
              </div>
            </motion.div>
          );
        })}
        {interimText && (
          <div className="flex gap-4 opacity-50">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 border border-gray-100">
              ?
            </div>
            <div className="flex-1">
              <p className="text-gray-500 italic">{interimText}...</p>
            </div>
          </div>
        )}
        {transcript.length === 0 && !interimText && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
            <MessageSquare size={48} className="mb-4" />
            <p className="text-lg font-medium">会話の記録はありません</p>
            <p className="text-sm">下のボタンを押して録音を開始してください</p>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="p-6 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={onToggleRecording}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95 ${
                isRecording 
                  ? 'bg-red-500 text-white hover:bg-red-600' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isRecording ? <Square size={24} fill="currentColor" /> : <Mic size={24} />}
            </button>
            <div>
              <p className="font-bold text-gray-900">{isRecording ? 'Recording...' : 'Ready to record'}</p>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(i => (
                    <motion.div 
                      key={i}
                      animate={isRecording ? { height: [4, 12, 4] } : { height: 4 }}
                      transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                      className={`w-1 rounded-full ${isRecording ? 'bg-red-400' : 'bg-gray-300'}`}
                    />
                  ))}
                </div>
                <span className="text-xs text-gray-500 font-mono">{elapsedLabel}</span>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">
                音声は文字起こし処理のため送信され、録音ファイルとして保存されません
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onExportPdf}
              disabled={transcript.length === 0}
              className="px-3 py-2 text-xs font-semibold text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
              title="録音全体をPDFとして保存"
            >
              <span className="inline-flex items-center gap-1.5">
                <FileDown size={16} />
                PDF保存
              </span>
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <LayoutDashboard size={20} />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <Clock size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const InsightPanel = ({ keyTerms, onAddTerm }: { keyTerms: { term: string, definition: string, detail?: string }[], onAddTerm: (term: string) => void }) => {
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [manualTerm, setManualTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!manualTerm.trim()) return;
    setIsAdding(true);
    await onAddTerm(manualTerm);
    setManualTerm('');
    setIsAdding(false);
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto custom-scrollbar space-y-8">
      {/* Manual Add */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb size={18} className="text-blue-600" />
          <h2 className="font-bold text-gray-800 tracking-tight">用語を調べる</h2>
        </div>
        <div className="flex gap-2">
          <input 
            type="text" 
            value={manualTerm}
            onChange={(e) => setManualTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="わからない言葉を入力..."
            className="flex-1 text-xs p-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:outline-none transition-all"
          />
          <button 
            onClick={handleAdd}
            disabled={isAdding}
            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isAdding ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ChevronRight size={18} />}
          </button>
        </div>
      </section>

      {/* Key Terms */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={18} className="text-pink-600" />
          <h2 className="font-bold text-gray-800 tracking-tight">用語解説</h2>
        </div>
        <div className="space-y-4">
          {keyTerms.length > 0 ? keyTerms.map((item, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`p-4 bg-pink-50/50 border border-pink-100 rounded-2xl cursor-pointer transition-all ${expandedTerm === item.term ? 'ring-2 ring-pink-400 shadow-md' : ''}`}
              onClick={() => setExpandedTerm(expandedTerm === item.term ? null : item.term)}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-pink-900 text-sm">{item.term}</h3>
                <ChevronRight size={14} className={`text-pink-400 transition-transform ${expandedTerm === item.term ? 'rotate-90' : ''}`} />
              </div>
              <p className="text-xs text-pink-800/70 leading-relaxed">{item.definition}</p>
              <AnimatePresence>
                {expandedTerm === item.term && item.detail && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-3 pt-3 border-t border-pink-100 overflow-hidden"
                  >
                    <p className="text-[11px] text-pink-900/60 leading-relaxed italic">
                      {item.detail}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )) : (
            <p className="text-sm text-gray-400 italic px-2">専門用語の解説がここに表示されます</p>
          )}
        </div>
      </section>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const SETTINGS_STORAGE_KEY = 'echo-map-settings';
  const [settings, setSettings] = useState<TranscriptionSettings>({
    transcriptionMode: 'high-accuracy',
    networkMode: 'balanced',
  });
  const {
    isRecording,
    transcript,
    interimText,
    transcriptionError,
    transcriptionStatusLabel,
    startRecording,
    stopRecording,
  } = useTranscription(settings);
  const [insights, setInsights] = useState<InsightData>({
    summary: '',
    nodes: [],
    keyTerms: []
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatusLabel, setAnalysisStatusLabel] = useState('解析待機');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const lastAnalyzedIndex = useRef(0);
  const lastAnalyzeAtRef = useRef(0);
  const analyzeDelayTimerRef = useRef<number | null>(null);
  const analyzeRetryTimerRef = useRef<number | null>(null);
  const latestTranscriptRef = useRef(transcript);
  const latestNodesRef = useRef(insights.nodes);
  const latestSummaryRef = useRef(insights.summary);
  const enqueueLatestAnalysisRef = useRef<(force?: boolean) => void>(() => {});
  const analysisQueueRef = useRef<LatestOnlyQueue<{
    fullText: string;
    transcriptLength: number;
    currentNodes: ConversationNode[];
    rollingSummary: string;
  }> | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Partial<TranscriptionSettings>;
      setSettings(prev => ({
        transcriptionMode:
          parsed.transcriptionMode === 'standard' || parsed.transcriptionMode === 'high-accuracy'
            ? parsed.transcriptionMode
            : prev.transcriptionMode,
        networkMode:
          parsed.networkMode === 'balanced' || parsed.networkMode === 'low-bandwidth'
            ? parsed.networkMode
            : prev.networkMode,
      }));
    } catch {
      // Ignore malformed saved settings.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    latestTranscriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    latestNodesRef.current = insights.nodes;
  }, [insights.nodes]);

  useEffect(() => {
    latestSummaryRef.current = insights.summary;
  }, [insights.summary]);

  const getAnalyzeMinInterval = useCallback(
    () => (settings.networkMode === 'low-bandwidth' ? 14000 : 8000),
    [settings.networkMode]
  );

  const getAnalyzeSegmentInterval = useCallback(
    () => (settings.networkMode === 'low-bandwidth' ? 5 : 3),
    [settings.networkMode]
  );

  const getAnalyzeContextSegments = useCallback(
    () => (settings.networkMode === 'low-bandwidth' ? 12 : 20),
    [settings.networkMode]
  );

  const getAnalyzeContextNodes = useCallback(
    () => (settings.networkMode === 'low-bandwidth' ? 40 : 70),
    [settings.networkMode]
  );

  if (!analysisQueueRef.current) {
    analysisQueueRef.current = new LatestOnlyQueue(async ({ fullText, transcriptLength, currentNodes, rollingSummary }) => {
      if (!fullText) return;
      if (analyzeRetryTimerRef.current) {
        window.clearTimeout(analyzeRetryTimerRef.current);
        analyzeRetryTimerRef.current = null;
      }
      setIsAnalyzing(true);
      setAnalysisStatusLabel('解析中');
      lastAnalyzeAtRef.current = Date.now();
      try {
        const result = await analyzeConversation(fullText, currentNodes, rollingSummary);
        if (result) {
          const normalizedNodes = result.nodes.slice(0, getAnalyzeContextNodes());
          setInsights(prev => ({
            summary: result.summary,
            nodes: normalizedNodes,
            keyTerms: [...prev.keyTerms, ...result.keyTerms.filter(t => !prev.keyTerms.find(pt => pt.term === t.term))]
          }));
          latestSummaryRef.current = result.summary;
          latestNodesRef.current = normalizedNodes;
          lastAnalyzedIndex.current = transcriptLength;
          setAnalysisStatusLabel('最新反映済み');
          setAnalysisError(null);
        } else {
          setAnalysisStatusLabel('解析再試行待ち');
          analyzeRetryTimerRef.current = window.setTimeout(() => enqueueLatestAnalysisRef.current(true), getAnalyzeMinInterval());
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : '会話解析に失敗しました。時間を置いて再試行してください。';
        setAnalysisError(message);
        setAnalysisStatusLabel('解析再試行中');
        analyzeRetryTimerRef.current = window.setTimeout(() => enqueueLatestAnalysisRef.current(true), getAnalyzeMinInterval());
      } finally {
        setIsAnalyzing(false);
      }
    });
  }

  const enqueueLatestAnalysis = useCallback((force = false) => {
    if (analyzeDelayTimerRef.current) {
      window.clearTimeout(analyzeDelayTimerRef.current);
      analyzeDelayTimerRef.current = null;
    }
    if (force && analyzeRetryTimerRef.current) {
      window.clearTimeout(analyzeRetryTimerRef.current);
      analyzeRetryTimerRef.current = null;
    }

    const currentTranscript = latestTranscriptRef.current;
    if (currentTranscript.length === 0) return;

    const now = Date.now();
    const minInterval = getAnalyzeMinInterval();
    const waitMs = Math.max(0, minInterval - (now - lastAnalyzeAtRef.current));

    const run = () => {
      const nextTranscript = latestTranscriptRef.current;
      const maxSegments = getAnalyzeContextSegments();
      const maxNodes = getAnalyzeContextNodes();
      const trimmedTranscript = nextTranscript.slice(-maxSegments);
      const omittedTranscriptCount = nextTranscript.length - trimmedTranscript.length;
      const transcriptLines = trimmedTranscript
        .map(t => `[ID:${t.id}] ${getSegmentSummaryLabel(t.text)}: ${t.text}`)
        .join('\n');
      const fullText = omittedTranscriptCount > 0
        ? `注記: 古い発言 ${omittedTranscriptCount} 件は省略。\n${transcriptLines}`
        : transcriptLines;
      const compactNodes = latestNodesRef.current
        .slice(-maxNodes)
        .map((node) => ({
          ...node,
          text: node.text.slice(0, 240),
          sourceTextSnippet: node.sourceTextSnippet?.slice(0, 120),
          sourceSegmentIds: node.sourceSegmentIds?.slice(-3),
        }));

      analysisQueueRef.current?.enqueue({
        fullText,
        transcriptLength: nextTranscript.length,
        currentNodes: compactNodes,
        rollingSummary: latestSummaryRef.current,
      });
      setAnalysisStatusLabel('解析待ち');
    };

    if (force || waitMs === 0) {
      run();
      return;
    }

    analyzeDelayTimerRef.current = window.setTimeout(run, waitMs);
  }, [getAnalyzeContextNodes, getAnalyzeContextSegments, getAnalyzeMinInterval]);

  const handleManualRefresh = useCallback((force = false) => {
    enqueueLatestAnalysis(force);
  }, [enqueueLatestAnalysis]);

  useEffect(() => {
    enqueueLatestAnalysisRef.current = enqueueLatestAnalysis;
  }, [enqueueLatestAnalysis]);

  // Analyze conversation every 3 segments
  useEffect(() => {
    if (transcript.length === 0 || transcript.length === lastAnalyzedIndex.current) return;
    const segmentInterval = getAnalyzeSegmentInterval();
    const reachedSegmentBoundary = transcript.length % segmentInterval === 0;
    const shouldCatchUpByTime = Date.now() - lastAnalyzeAtRef.current > getAnalyzeMinInterval();
    if (reachedSegmentBoundary || shouldCatchUpByTime) {
      handleManualRefresh();
    }
  }, [getAnalyzeMinInterval, getAnalyzeSegmentInterval, handleManualRefresh, transcript]);

  useEffect(() => {
    return () => {
      if (analyzeDelayTimerRef.current) {
        window.clearTimeout(analyzeDelayTimerRef.current);
      }
      if (analyzeRetryTimerRef.current) {
        window.clearTimeout(analyzeRetryTimerRef.current);
      }
    };
  }, []);

  const updateSettings = (next: Partial<TranscriptionSettings>) => {
    setSettings(prev => ({ ...prev, ...next }));
  };

  const handleManualAddTerm = async (term: string) => {
    try {
      const result = await getTermDefinition(term);
      setInsights(prev => ({
        ...prev,
        keyTerms: [result, ...prev.keyTerms.filter(t => t.term !== result.term)]
      }));
      setAnalysisError(null);
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : '用語解説の取得に失敗しました。'
      );
    }
  };

  const handleExportPdf = async () => {
    if (transcript.length === 0) return;

    const defaultFileName = `会話記録-${new Date().toISOString().slice(0, 10)}`;
    const requestedFileName = window.prompt('PDFのファイル名を入力してください', defaultFileName);
    if (requestedFileName === null) return;
    const pdfFileName = normalizePdfFilename(requestedFileName, defaultFileName);

    const pdfRoot = document.createElement('div');
    pdfRoot.style.padding = '28px';
    pdfRoot.style.background = '#ffffff';
    pdfRoot.style.color = '#111827';
    pdfRoot.style.fontFamily = 'sans-serif';
    pdfRoot.style.width = '800px';

    const rows = transcript
      .map((seg, index) => {
        const label = getSegmentSummaryLabel(seg.text);
        const time = new Date(seg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
          <li style="margin-bottom: 14px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px;">
              <strong style="font-size:13px;">${index + 1}. ${escapeHtml(label)}</strong>
              <span style="font-size:11px; color:#6B7280;">${time}</span>
            </div>
            <p style="margin:0; font-size:13px; line-height:1.6;">${escapeHtml(seg.text)}</p>
          </li>
        `;
      })
      .join('');

    const termRows = insights.keyTerms
      .map(item => `<li style="margin-bottom:8px;"><strong>${escapeHtml(item.term)}</strong>: ${escapeHtml(item.definition)}</li>`)
      .join('');

    pdfRoot.innerHTML = `
      <h1 style="margin:0 0 8px; font-size:24px;">会話記録レポート</h1>
      <p style="margin:0 0 16px; font-size:12px; color:#6B7280;">
        出力日時: ${new Date().toLocaleString()}
      </p>
      <section style="margin-bottom:18px;">
        <h2 style="font-size:16px; margin:0 0 8px;">全体要約</h2>
        <p style="font-size:13px; line-height:1.7; margin:0;">${escapeHtml(insights.summary || '要約はまだ生成されていません。')}</p>
      </section>
      <section style="margin-bottom:18px;">
        <h2 style="font-size:16px; margin:0 0 8px;">録音内容（全文）</h2>
        <ol style="padding-left:18px; margin:0;">${rows}</ol>
      </section>
      <section>
        <h2 style="font-size:16px; margin:0 0 8px;">キーワード</h2>
        <ul style="padding-left:18px; margin:0;">${termRows || '<li>キーワードはまだありません。</li>'}</ul>
      </section>
    `;

    document.body.appendChild(pdfRoot);

    try {
      await html2pdf()
        .set({
          margin: 0.5,
          filename: pdfFileName,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        })
        .from(pdfRoot)
        .save();
    } finally {
      document.body.removeChild(pdfRoot);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] font-sans text-gray-900 selection:bg-blue-100">
      <Header
        settings={settings}
        onSettingsChange={updateSettings}
        transcriptionStatusLabel={transcriptionStatusLabel}
        analysisStatusLabel={analysisStatusLabel}
        isRecording={isRecording}
      />
      
      <main className="flex-1 overflow-hidden">
        <Group direction="horizontal">
          {/* Left Column: Logical Map */}
          <Panel defaultSize={40} minSize={20}>
            <div className="h-full bg-gray-50/50 border-r border-gray-200">
              <LogicalMap 
                conversationNodes={insights.nodes} 
                selectedNodeId={selectedNodeId}
                onNodeSelect={setSelectedNodeId}
                isAnalyzing={isAnalyzing}
                onRefresh={() => handleManualRefresh(true)}
              />
            </div>
          </Panel>

          <Separator className="w-1 hover:w-1.5 bg-gray-200 hover:bg-blue-400 transition-all duration-200 cursor-col-resize relative z-50" />

          {/* Center Column: Main Stream */}
          <Panel defaultSize={35} minSize={25}>
            <div className="h-full">
              <MainStream 
                transcript={transcript} 
                interimText={interimText}
                summary={insights.summary}
                isRecording={isRecording}
                onToggleRecording={isRecording ? stopRecording : startRecording}
                onExportPdf={handleExportPdf}
                selectedNodeId={selectedNodeId}
                conversationNodes={insights.nodes}
                keyTerms={insights.keyTerms}
                errorMessage={transcriptionError || analysisError}
              />
            </div>
          </Panel>

          <Separator className="w-1 hover:w-1.5 bg-gray-200 hover:bg-blue-400 transition-all duration-200 cursor-col-resize relative z-50" />

          {/* Right Column: Insights */}
          <Panel defaultSize={25} minSize={15}>
            <div className="h-full bg-gray-50/50">
              <InsightPanel 
                keyTerms={insights.keyTerms} 
                onAddTerm={handleManualAddTerm}
              />
            </div>
          </Panel>
        </Group>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D1D5DB;
        }
      `}} />
    </div>
  );
}
