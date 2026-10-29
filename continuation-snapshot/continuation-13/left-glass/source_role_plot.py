"""CPU source-only orthographic role witness, never a shading/appearance proof."""
from pathlib import Path
import json,numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
B=Path(__file__).resolve().parent;C9=B.parents[1]/'continuation-9/garage-bulbs';audit=json.loads((C9/'SOURCE_AUDIT.json').read_text());row=next(w for w in audit['walls']if w['stem']=='05_GARAGE_L')['objects'][0];z=np.load(C9/row['source_geometry_dump']);glass=row['source_effective_material_slots'].index('glass');all_edges=[];glass_edges=[]
for i,(start,total)in enumerate(zip(z['polygon_starts'],z['polygon_totals'])):
 v=z['loop_vertices'][int(start):int(start+total)]
 for j in range(len(v)):
  edge=z['positions'][[v[j],v[(j+1)%len(v)]]];all_edges.append(edge)
  if z['material_indices'][i]==glass:glass_edges.append(edge)
all_edges=np.array(all_edges);glass_edges=np.array(glass_edges);fig,axes=plt.subplots(1,3,figsize=(12,4),layout='constrained')
for ax,plane in zip(axes,[(0,1),(0,2),(1,2)]):
 ax.add_collection(LineCollection(all_edges[:,:,plane],colors='#c0c0c0',linewidths=.2,alpha=.35));ax.add_collection(LineCollection(glass_edges[:,:,plane],colors='#0872b9',linewidths=.3));ax.autoscale();ax.set_aspect('equal');ax.set_title('Source '+''.join('XYZ'[p]for p in plane));ax.set_xlabel('XYZ'[plane[0]]);ax.set_ylabel('XYZ'[plane[1]])
fig.suptitle('Historical source Left bulb.048: actual GLASS polygons only in blue (1,088); other source faces grey')
fig.savefig(B/'source-glass-role-projections.png',dpi=150);plt.close(fig);print('SOURCE_ONLY_ROLE_PLOT_READY')
