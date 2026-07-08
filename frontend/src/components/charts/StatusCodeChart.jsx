import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import ChartCard from './ChartCard';

const COLORS = { '2xx': '#22d3ee', '3xx': '#0ea5e9', '4xx': '#f59e0b', '5xx': '#f43f5e', '1xx': '#64748b', 'unknown': '#475569' };
const tooltipStyle = { backgroundColor: 'rgb(15 23 42)', border: '1px solid rgb(51 65 85)', borderRadius: 8, fontSize: 12, color: 'rgb(226 232 240)' };

export default function StatusCodeChart({ data = [], loading }) {
  const total = data.reduce((sum, d) => sum + Number(d.count), 0);
  return (
    <ChartCard title="Status Code Distribution" subtitle={`${total.toLocaleString()} responses in the selected window`} loading={loading}>
      {total === 0 ? (
        <div className="h-[260px] flex items-center justify-center text-sm text-slate-500">No requests yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="bucket" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="rgb(2 6 23)" strokeWidth={2}>
              {data.map((entry) => <Cell key={entry.bucket} fill={COLORS[entry.bucket] || '#64748b'} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${Number(value).toLocaleString()} requests`, name]} />
            <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{ fontSize: 11, color: 'rgb(148 163 184)' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
