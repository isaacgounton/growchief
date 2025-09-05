import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Background,
  MarkerType,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import useLocalStorage from "use-local-storage";
import {
  useMenu,
  WorkflowMenu,
} from "@growchief/frontend/components/workflows/workflow.menu.tsx";
import { WorkflowNode } from "@growchief/frontend/components/workflows/workflow.node.tsx";
import { useNavigate, useParams } from "react-router";
import {
  useWorkflowById,
  useWorkflowsRequest,
} from "@growchief/frontend/requests/workflows.request.ts";
import type { WorkflowNodes, Workflows } from "@prisma/client";
import { FitWorkflow } from "@growchief/frontend/components/workflows/fit.workflow.tsx";
import clsx from "clsx";
import { timer } from "@growchief/shared-both/utils/timer.ts";
import {
  closeMenuEmitter,
  selectedEmitter,
} from "@growchief/frontend/components/workflows/workflow.node.wrapper.tsx";
import { WorkflowApi } from "@growchief/frontend/components/workflows/workflow.api.tsx";
import { Input } from "@growchief/frontend/components/ui/input.tsx";
import { Button } from "@growchief/frontend/components/ui/button.tsx";
import { PlatformsGroupsAndOptionsWrapper } from "@growchief/frontend/components/workflows/platforms.groups.and.options.tsx";
import { refs } from "@growchief/frontend/components/workflows/nodes/high.order.node.tsx";
import { useToaster } from "@growchief/frontend/utils/use.toaster.tsx";
import { Select } from "@growchief/frontend/components/ui/select.tsx";
import { useDecisionModal } from "@growchief/frontend/utils/use.decision.modal.tsx";
import { useModals } from "@growchief/frontend/utils/store.ts";
import { GetCodeComponent } from "@growchief/frontend/components/workflows/get.code.component.tsx";

export const WorkflowEditPageData: FC = () => {
  const params = useParams();
  const push = useNavigate();
  const { data, isLoading } = useWorkflowById(params.id || "");
  const [load, setLoad] = useState(false);

  useEffect(() => {
    setLoad(true);

    return () => {
      setLoad(false);
    };
  }, []);

  useEffect(() => {
    if (!isLoading && !data) {
      push(`/workflows`);
    }
  }, [isLoading, data]);

  if (isLoading) {
    return (
      <div className="flex-1 relative bg-innerBackground rounded-b-[8px]" />
    );
  }

  if (!data || !load) {
    return (
      <div className="flex-1 relative bg-innerBackground rounded-b-[8px]" />
    );
  }

  return (
    <ReactFlowProvider>
      <PlatformsGroupsAndOptionsWrapper>
        <WorkflowEditPage workflow={data!} />
      </PlatformsGroupsAndOptionsWrapper>
    </ReactFlowProvider>
  );
};

export const WorkflowEditPage: FC<{
  workflow: Workflows & { nodes: WorkflowNodes[] };
}> = ({ workflow }) => {
  const [pageName, setPageName] = useState(workflow.name || "");
  const [state, setState] = useState(workflow.active ? "active" : "inactive");
  const { getNodes, getEdges } = useReactFlow();
  const toaster = useToaster();
  const workflowRequest = useWorkflowsRequest();
  const decisionModal = useDecisionModal();
  const modals = useModals();

  const getActive = useCallback(() => {
    if (state === "active") {
      return true;
    }

    if (workflow.nodes.length === 1 && state === "inactive") {
      return decisionModal.open({
        label: "Not active",
        description: "This workflow is not active. Do you want to active it?",
        approveLabel: "Activate",
        cancelLabel: "Cancel",
      });
    }

    return state === "active";
  }, [state]);

  const save = useCallback(async () => {
    const nodes = getNodes();
    if (nodes.length === 1) {
      toaster.show("Workflow must have at least one node", "warning");
      return;
    }
    if (
      nodes.some(
        (p) => p?.data?.identifier === "add-account" && !p.data.account,
      )
    ) {
      toaster.show(
        "Please select an account for all Add accounts nodes",
        "warning",
      );
      return;
    }
    const mapper = {} as Record<string, any>;
    for (const [key, value] of Object.entries(refs)) {
      const getValues = await value();
      if (!getValues) {
        toaster.show("Some of the settings are not filled", "warning");
        return;
      }

      mapper[key] = getValues;
    }

    const active = await getActive();

    const edges = getEdges();
    const newData = {
      name: pageName,
      active,
      nodes: nodes.map((p) => ({
        id: p.id,
        type: p.type,
        data: {
          identifier: p.data.identifier || "node",
          label: p.data.label || "",
          ...p.data,
          settings: mapper[p.id],
        },
        position: JSON.stringify(p.position),
        parent: edges.find((f) => f.target === p.id)?.source || null,
      })),
    };

    await workflowRequest.updateWorkflow(workflow.id, newData);
    toaster.show("Workflow saved successfully", "success");
    setState(active ? "active" : "inactive");
  }, [pageName, state]);

  const getCode = useCallback(() => {
    modals.show({
      label: "Workflow Code",
      component: (close) => <GetCodeComponent id={workflow.id} close={close} />,
    });
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-innerBackground items-end gap-[20px] flex pt-[10px] text-[12px] px-[20px] pb-[10px]">
        <div className="flex flex-1 flex-col gap-2">
          <div>Workflow Name</div>
          <Input
            value={pageName}
            onChange={(event) => setPageName(event.target.value)}
          />
        </div>
        <div>
          <div>State</div>
          <Select
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        <div>
          <Button onClick={save}>Save</Button>
        </div>
        <div>
          <Button onClick={getCode}>Get Code</Button>
        </div>
      </div>
      <WorkflowEditPageInner workflow={workflow!} />
    </div>
  );
};

export const WorkflowEditPageInner: FC<{
  workflow: Workflows & { nodes: WorkflowNodes[] };
}> = ({ workflow }) => {
  const [mode] = useLocalStorage("mode", "dark");
  const ref = useRef(null);
  const [load, setLoad] = useState(false);
  const [fitWorkflow, setFitWorkflow] = useState(false);
  const menu = useMenu();

  const [nodes, setNodes] = useNodesState(
    workflow.nodes.map((p) => ({
      id: p.id,
      selectable: false,
      type: p.type,
      dragHandle: ".nodrag",
      position: JSON.parse(p.position),
      data: JSON.parse(p.data || "{}"),
    })),
  );

  const [edges, setEdges] = useEdgesState(
    workflow.nodes
      .filter((f) => f.parentId)
      .map((p) => ({
        id: `${p.parentId}-${p.id}`,
        source: p.parentId!,
        target: p.id,
        style: { stroke: "#612BD3", strokeWidth: 2 },
        markerEnd: { type: MarkerType.Arrow, color: "#612BD3" },
      })),
  );

  const onNodesChange = useCallback(
    (changes: any) =>
      setNodes((nodesSnapshot) => {
        return applyNodeChanges(changes, nodesSnapshot);
      }),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: any) =>
      setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );
  const onConnect = useCallback(
    (params: any) =>
      setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );

  return (
    <div className="flex-1 relative bg-innerBackground rounded-b-[8px]">
      <div
        className={clsx(
          "absolute top-0 left-0 w-full h-full opacity-0",
          !load ? "invisible" : "animate-fadeIn",
        )}
        ref={ref}
      >
        <ReactFlow
          maxZoom={1}
          minZoom={1}
          nodeTypes={{ api: WorkflowApi, default: WorkflowNode }}
          zoomOnScroll={false}
          panOnScroll={true}
          colorMode={mode as "dark" | "light"}
          nodes={nodes}
          edges={edges}
          onPaneClick={() => {
            closeMenuEmitter.emit("closeMenu");
            menu.close();
            selectedEmitter.emit("selectNode", null);
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={async () => {
            await timer(200);
            setFitWorkflow(true);
          }}
        >
          <WorkflowMenu />
          <Background className="!bg-innerBackground" />
          {fitWorkflow && (
            <FitWorkflow wrapperRef={ref} setLoaded={() => setLoad(true)} />
          )}
        </ReactFlow>
      </div>
    </div>
  );
};
