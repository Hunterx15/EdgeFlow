import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

const tooltipStyle = { backgroundColor: 'rgb(15 23 42)', border: '1px solid rgb(51 65 85)', borderRadius: 8, fontSize: 12, color: 'rgb(226 232 240)' };

export default function LiveRequestsChart({ data = [], loading }) {
  return (
    <ChartCard title="Live Request Volume" subtitle="Per-minute requests and errors over the last 60 minutes" loading={loading}
      action={<div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand-400" /> Requests</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" /> Errors</span>
      </div>}>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(30 41 59)" />
          <XAxis dataKey="label" stroke="rgb(100 116 139)" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
          <YAxis stroke="rgb(100 116 139)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="requests" stroke="#22d3ee" strokeWidth={2} fill="url(#reqGrad)" name="Requests" />
          <Area type="monotone" dataKey="errors" stroke="#f43f5e" strokeWidth={2} fill="url(#errGrad)" name="Errors" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
